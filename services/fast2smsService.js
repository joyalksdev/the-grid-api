// backend/services/fast2smsService.js

// Normalize any Indian phone string ("+91 98765 43210", "919876543210", "9876543210") to 10 digits
function normalizeIndianMobile(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

function isRealCredential(val) {
  if (!val) return false;
  const trimmed = String(val).trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('your_') || trimmed === 'placeholder') return false;
  return true;
}

/**
 * Sends a 6-digit OTP via Fast2SMS.
 * Priority:
 * 1. Fast2SMS WhatsApp Template API (`https://www.fast2sms.com/dev/whatsapp`)
 *    if FAST2SMS_API_KEY, FAST2SMS_OTP_TEMPLATE_ID, and FAST2SMS_PHONE_NUMBER_ID are set.
 * 2. Fast2SMS Dedicated OTP / BulkV2 SMS API (`https://www.fast2sms.com/dev/bulkV2`)
 *    if FAST2SMS_API_KEY is set.
 * 3. Development Console Mode (if keys are not yet configured in .env) so local testing never blocks.
 */
async function sendOtpViaFast2SMS(phone, otpCode, customerName = 'Player') {
  const mobile = normalizeIndianMobile(phone);
  const apiKey = process.env.FAST2SMS_API_KEY;
  const otpTemplateId = process.env.FAST2SMS_OTP_TEMPLATE_ID;
  const phoneNumberId = process.env.FAST2SMS_PHONE_NUMBER_ID;

  // If API key is not configured yet, log OTP in server console for easy local testing
  if (!isRealCredential(apiKey)) {
    console.log(
      `🔑 [DEV OTP] Mobile: +91 ${mobile} | Code: ${otpCode} (Add FAST2SMS_API_KEY in .env for live delivery)`
    );
    return { delivered: true, channel: 'dev_console' };
  }

  // Route A: Fast2SMS Official WhatsApp Template API
  if (isRealCredential(otpTemplateId) && isRealCredential(phoneNumberId)) {
    const url = new URL('https://www.fast2sms.com/dev/whatsapp');
    url.searchParams.set('authorization', apiKey);
    url.searchParams.set('message_id', otpTemplateId);
    url.searchParams.set('phone_number_id', phoneNumberId);
    url.searchParams.set('numbers', mobile);
    url.searchParams.set('variables_values', String(otpCode));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: apiKey,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.return === false) {
      console.error('Fast2SMS WhatsApp OTP Error:', data);
      throw new Error(
        data.message || 'Failed to send WhatsApp verification code'
      );
    }

    return { delivered: true, channel: 'whatsapp', data };
  }

  // Route B: Fast2SMS Dedicated OTP API (if otp_id is set)
  if (isRealCredential(otpTemplateId)) {
    const response = await fetch('https://www.fast2sms.com/dev/otp/send', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mobile,
        otp_id: otpTemplateId,
        otp: String(otpCode),
        variables_values: String(otpCode),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.return === false) {
      console.error('Fast2SMS OTP Send Error:', data);
      throw new Error(data.message || 'Failed to send verification code');
    }

    return { delivered: true, channel: 'sms_otp', data };
  }

  // Route C: Standard Fast2SMS BulkV2 OTP Route
  const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      route: 'otp',
      variables_values: String(otpCode),
      numbers: mobile,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.return === false) {
    console.error('Fast2SMS BulkV2 OTP Error:', data);
    throw new Error(data.message || 'Failed to send SMS OTP');
  }

  return { delivered: true, channel: 'sms_bulkv2', data };
}

// Cache resolved Fast2SMS template & number metadata
let cachedTemplates = null;
let cachedNumbers = null;
let lastTemplateFetchAt = 0;

/**
 * Fetches connected WhatsApp numbers & approved templates from Fast2SMS DLT/WhatsApp Manager API:
 * - GET https://www.fast2sms.com/dev/dlt_manager/whatsapp?type=number
 * - GET https://www.fast2sms.com/dev/dlt_manager/whatsapp?type=template
 *
 * Maps Meta's 15-digit `template_id` (e.g. 993231603236327) or `template_name`
 * (e.g. "the_grid_booking_pass") to Fast2SMS's internal short `message_id` (e.g. 8340)
 * and exact `phone_number_id`.
 */
async function resolveFast2SMSTemplate(apiKey, rawIdOrName, envPhoneNumberId) {
  const now = Date.now();
  if (!cachedTemplates || now - lastTemplateFetchAt > 60 * 1000) {
    try {
      const [numRes, tplRes] = await Promise.all([
        fetch('https://www.fast2sms.com/dev/dlt_manager/whatsapp?type=number', {
          method: 'GET',
          headers: { Authorization: apiKey, accept: 'application/json' },
        }).catch(() => null),
        fetch('https://www.fast2sms.com/dev/dlt_manager/whatsapp?type=template', {
          method: 'GET',
          headers: { Authorization: apiKey, accept: 'application/json' },
        }).catch(() => null),
      ]);

      if (numRes) {
        const numJson = await numRes.json().catch(() => ({}));
        if (Array.isArray(numJson?.data) && numJson.data.length > 0) {
          cachedNumbers = numJson.data;
          console.log(
            '📱 [Fast2SMS Connected Numbers]:',
            cachedNumbers.map((n) => ({
              phone_number_id: n.phone_number_id,
              waba_id: n.waba_id,
              number: n.number,
              verified_name: n.verified_name,
            }))
          );
        }
      }

      if (tplRes) {
        const json = await tplRes.json().catch(() => ({}));
        const list = [];
        if (Array.isArray(json?.data)) {
          for (const waba of json.data) {
            const wabaPhoneId = waba.phone_number_id;
            if (Array.isArray(waba.templates)) {
              for (const tpl of waba.templates) {
                list.push({
                  ...tpl,
                  phone_number_id: tpl.phone_number_id || wabaPhoneId,
                  waba_id: waba.waba_id,
                });
              }
            } else if (waba.message_id || waba.template_id || waba.template_name) {
              list.push(waba);
            }
          }
        }
        cachedTemplates = list;
        lastTemplateFetchAt = now;

        if (list.length > 0) {
          console.log(
            '📋 [Fast2SMS WhatsApp Templates Synced]:',
            list.map((t) => ({
              fast2sms_message_id: t.message_id,
              meta_template_id: t.template_id,
              template_name: t.template_name,
              phone_number_id: t.phone_number_id,
              language: t.language,
              status: t.status,
              var_count: t.var_count,
            }))
          );
        } else {
          console.warn(
            '⚠️ [Fast2SMS] No synced templates returned by Fast2SMS dlt_manager. If you created the template in Meta WhatsApp Manager, click "Sync Templates" in Fast2SMS Dashboard → WhatsApp → Templates.'
          );
        }
      }
    } catch (err) {
      console.error('⚠️ [Fast2SMS] Could not fetch template list:', err.message);
    }
  }

  const fallbackPhoneId =
    (Array.isArray(cachedNumbers) && cachedNumbers[0]?.phone_number_id) ||
    envPhoneNumberId;

  if (Array.isArray(cachedTemplates) && cachedTemplates.length > 0) {
    const target = String(rawIdOrName || '').trim();
    const matched =
      cachedTemplates.find(
        (t) =>
          String(t.message_id) === target ||
          String(t.template_id) === target ||
          String(t.template_name).toLowerCase() === target.toLowerCase()
      ) ||
      cachedTemplates.find((t) =>
        ['the_grid_booking_pass', 'booking_ticket_confirmed'].includes(
          String(t.template_name).toLowerCase()
        )
      ) ||
      cachedTemplates[0];

    if (matched) {
      const bodyComp = Array.isArray(matched.components)
        ? matched.components.find((c) => c.type === 'BODY')
        : null;
      const buttonComp = Array.isArray(matched.components)
        ? matched.components.find((c) => c.type === 'BUTTONS')
        : null;
      const hasButtonVar = buttonComp
        ? JSON.stringify(buttonComp).includes('{{1}}')
        : false;
      const bodyHasRupeePrefix = bodyComp?.text
        ? /₹\s*\{\{6\}\}/.test(bodyComp.text)
        : false;

      return {
        messageId: String(matched.message_id),
        phoneNumberId: String(matched.phone_number_id || fallbackPhoneId),
        templateName: matched.template_name || 'the_grid_booking_pass',
        language: matched.language || 'en',
        varCount: matched.var_count,
        hasButtonVar,
        bodyHasRupeePrefix,
      };
    }
  }

  return {
    messageId: String(rawIdOrName || '').trim(),
    phoneNumberId: String(fallbackPhoneId || '').trim(),
    templateName: 'the_grid_booking_pass',
    language: 'en',
    varCount: 6,
    hasButtonVar: true,
    bodyHasRupeePrefix: false,
  };
}

/**
 * Fallback: Send directly via Fast2SMS's Meta Cloud API format endpoint
 * (`POST https://www.fast2sms.com/dev/whatsapp/v24.0/{phone_number_id}/messages`)
 * using `template_name` ("the_grid_booking_pass") when Fast2SMS's short `message_id` is not synced yet.
 */
async function sendViaMetaCloudFormat({
  apiKey,
  phoneNumberId,
  mobile,
  templateName = 'the_grid_booking_pass',
  languageCode = 'en',
  bodyParams = [],
  buttonToken = null,
  includeButton = true,
}) {
  const toPhone = `+91${mobile}`;
  const components = [
    {
      type: 'body',
      parameters: bodyParams.map((val) => ({
        type: 'text',
        text: String(val),
      })),
    },
  ];

  if (includeButton && buttonToken) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [
        {
          type: 'text',
          text: String(buttonToken),
        },
      ],
    });
  }

  const endpoint = `https://www.fast2sms.com/dev/whatsapp/v24.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: Boolean(res.ok && data.return !== false && !data.error), data };
}

/**
 * Sends a WhatsApp Booking Pass Confirmation message via Fast2SMS WhatsApp Utility Template
 * (`the_grid_booking_pass`)
 *
 * 6 Body Variables (pipe-separated):
 * 1. customerName
 * 2. bookingCode
 * 3. screenLabel
 * 4. mode & duration (e.g. "Single · 60 Mins")
 * 5. date & time (e.g. "2026-11-13 · 07:00 PM")
 * 6. totalAmount (e.g. "₹160")
 */
async function sendTicketViaFast2SMS({
  phone,
  customerName,
  bookingCode,
  screenLabel,
  station,
  mode = 'Single',
  date,
  slot,
  duration,
  totalAmount,
  price,
  ticketToken,
}) {
  const mobile = normalizeIndianMobile(phone);
  const apiKey = process.env.FAST2SMS_API_KEY;
  const ticketTemplateId = process.env.FAST2SMS_TICKET_TEMPLATE_ID;
  const phoneNumberId = process.env.FAST2SMS_PHONE_NUMBER_ID;

  const finalScreenLabel = screenLabel || station || 'Screen 1';
  const finalAmount = totalAmount !== undefined ? totalAmount : price;
  const cleanMode =
    mode === 'GTA6_Launch' ? 'GTA VI Launch' : mode || 'Single';
  const modeAndDuration = `${cleanMode} · ${duration} Mins`;
  const dateAndTime = `${date} · ${slot}`;

  if (!isRealCredential(apiKey)) {
    console.warn(
      `⚠️ [FAST2SMS SKIPPED - DEV MODE] Missing FAST2SMS_API_KEY in .env | To: +91 ${mobile}`
    );
    return { delivered: false, channel: 'dev_console' };
  }

  try {
    // 1. Auto-resolve Fast2SMS short `message_id` and `phone_number_id` from Fast2SMS DLT/WhatsApp Manager
    const resolved = await resolveFast2SMSTemplate(
      apiKey,
      ticketTemplateId,
      phoneNumberId
    );

    const amountStr = resolved.bodyHasRupeePrefix
      ? `${finalAmount}`
      : `₹${finalAmount}`;
    const bodyParams = [
      customerName,
      bookingCode,
      finalScreenLabel,
      modeAndDuration,
      dateAndTime,
      amountStr,
    ];

    // Fast2SMS Simple API (/dev/whatsapp) maps pipe-separated `variables_values` sequentially across
    // body variables (1..6) AND the dynamic URL button suffix (7th variable). If the 7th variable is omitted,
    // Fast2SMS substitutes "*" into the button URL (`https://www.thegridgaming.fun/ticket/*`).
    const allVariables = ticketToken
      ? [...bodyParams, String(ticketToken)].join('|')
      : bodyParams.join('|');

    // Primary Route: Use Fast2SMS Meta Cloud API Format (explicitly maps body + URL button `index: "0"`)
    if (ticketToken) {
      const metaRes = await sendViaMetaCloudFormat({
        apiKey,
        phoneNumberId: resolved.phoneNumberId,
        mobile,
        templateName: resolved.templateName || 'the_grid_booking_pass',
        languageCode: resolved.language || 'en',
        bodyParams,
        buttonToken: String(ticketToken),
        includeButton: true,
      });

      if (metaRes.ok) {
        console.log(
          `✅ [FAST2SMS WHATSAPP SENT (META FORMAT)] To: +91 ${mobile} | Ticket URL: https://www.thegridgaming.fun/ticket/${ticketToken} | Response:`,
          metaRes.data
        );
        return { delivered: true, data: metaRes.data };
      }

      console.warn(
        '⚠️ [FAST2SMS META FORMAT FALLBACK TO SIMPLE API]:',
        metaRes.data
      );
    }

    // Fallback / Simple GET Route: pass all 7 variables (6 body + 1 button token) in `variables_values`
    const url = new URL('https://www.fast2sms.com/dev/whatsapp');
    url.searchParams.set('authorization', apiKey);
    url.searchParams.set('message_id', resolved.messageId);
    url.searchParams.set('phone_number_id', resolved.phoneNumberId);
    url.searchParams.set('numbers', mobile);
    url.searchParams.set('variables_values', allVariables);
    if (ticketToken) {
      url.searchParams.set('button_variables_values', String(ticketToken));
    }

    console.log(
      `📤 [FAST2SMS DISPATCH] Sending "${resolved.templateName}" (message_id=${resolved.messageId}, phone_number_id=${resolved.phoneNumberId}) to +91 ${mobile}`
    );

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: apiKey,
      },
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok && data.return !== false) {
      console.log(`✅ [FAST2SMS WHATSAPP SENT] To: +91 ${mobile} | Response:`, data);
      return { delivered: true, data };
    }

    console.error('❌ [FAST2SMS WHATSAPP API ERROR]:', data);
    return { delivered: false, data };
  } catch (err) {
    console.error('Fast2SMS Ticket WhatsApp error:', err.message);
    return { delivered: false, error: err.message };
  }
}

module.exports = {
  normalizeIndianMobile,
  sendOtpViaFast2SMS,
  sendTicketViaFast2SMS,
};
