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

/**
 * Sends a WhatsApp Booking Pass Confirmation message via Fast2SMS WhatsApp Utility Template
 * (`booking_ticket_confirmed`) with a dynamic URL button pointing to:
 * https://thegridgaming.fun/ticket/{{1}}
 *
 * 6 Body Variables (pipe-separated):
 * 1. customerName
 * 2. bookingCode
 * 3. screenLabel
 * 4. mode & duration (e.g. "Single · 60 Mins")
 * 5. date & time (e.g. "2026-11-13 · 07:00 PM")
 * 6. totalAmount (e.g. "₹160")
 *
 * Button Variable (`button_variables_values`):
 * {{1}} -> booking.ticketToken (48-char hex token)
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
  const modeAndDuration = `${mode} · ${duration} Mins`;
  const dateAndTime = `${date} · ${slot}`;
  const bodyVariables = `${customerName}|${bookingCode}|${finalScreenLabel}|${modeAndDuration}|${dateAndTime}|₹${finalAmount}`;

  if (
    !isRealCredential(apiKey) ||
    !isRealCredential(ticketTemplateId) ||
    !isRealCredential(phoneNumberId)
  ) {
    console.log(
      `🎟️ [DEV TICKET WHATSAPP] To: +91 ${mobile} | Variables: ${bodyVariables} | Button URL: https://thegridgaming.fun/ticket/${ticketToken}`
    );
    return { delivered: false, channel: 'dev_console' };
  }

  try {
    const url = new URL('https://www.fast2sms.com/dev/whatsapp');
    url.searchParams.set('authorization', apiKey);
    url.searchParams.set('message_id', ticketTemplateId);
    url.searchParams.set('phone_number_id', phoneNumberId);
    url.searchParams.set('numbers', mobile);
    url.searchParams.set('variables_values', bodyVariables);
    if (ticketToken) {
      url.searchParams.set('button_variables_values', String(ticketToken));
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: apiKey,
      },
    });
    const data = await response.json().catch(() => ({}));
    return { delivered: Boolean(response.ok && data.return !== false), data };
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
