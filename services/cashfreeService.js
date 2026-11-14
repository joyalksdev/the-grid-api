// backend/services/cashfreeService.js
const crypto = require('crypto');
const { normalizeIndianMobile } = require('./fast2smsService');

function isRealValue(val) {
  if (!val) return false;
  const str = String(val).trim();
  if (!str || str.startsWith('your_') || str === 'placeholder') return false;
  return true;
}

function getCashfreeConfig() {
  const appId = (process.env.CASHFREE_APP_ID || '').trim();
  const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
  const env = (process.env.CASHFREE_ENV || 'SANDBOX').trim().toUpperCase();
  const apiVersion = (process.env.CASHFREE_API_VERSION || '2023-08-01').trim();
  const webhookSecret = isRealValue(process.env.CASHFREE_WEBHOOK_SECRET)
    ? process.env.CASHFREE_WEBHOOK_SECRET.trim()
    : secretKey;

  const isProd = env === 'PRODUCTION' || env === 'PROD';
  const baseUrl = isProd
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

  return {
    appId,
    secretKey,
    env: isProd ? 'PRODUCTION' : 'SANDBOX',
    sdkMode: isProd ? 'production' : 'sandbox',
    apiVersion,
    webhookSecret,
    baseUrl,
    isConfigured: isRealValue(appId) && isRealValue(secretKey),
  };
}

function getCashfreeHeaders(config) {
  return {
    'Content-Type': 'application/json',
    'x-api-version': config.apiVersion,
    'x-client-id': config.appId,
    'x-client-secret': config.secretKey,
  };
}

/**
 * Creates a Cashfree PG Order (API v2023-08-01) and returns payment_session_id
 */
async function createCashfreeOrder({
  orderId,
  amount,
  customerId,
  customerName,
  customerPhone,
  returnUrl,
  notifyUrl,
  orderNote,
}) {
  const config = getCashfreeConfig();
  if (!config.isConfigured) {
    throw new Error(
      'Cashfree credentials (CASHFREE_APP_ID / CASHFREE_SECRET_KEY) are not configured in .env'
    );
  }

  const cleanPhone = normalizeIndianMobile(customerPhone) || '9999999999';
  const safeCustomerId = String(customerId || `cust_${cleanPhone}`).replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );

  const payload = {
    order_id: orderId,
    order_amount: Number(Number(amount).toFixed(2)),
    order_currency: 'INR',
    customer_details: {
      customer_id: safeCustomerId,
      customer_name: (customerName || 'Grid Player').trim(),
      customer_phone: cleanPhone,
    },
    order_meta: {},
    order_note: orderNote || 'The Grid Gaming Lounge Booking Pass',
  };

  if (returnUrl) {
    // Cashfree PG API v2023-08-01 requires return_url to use https://
    payload.order_meta.return_url = String(returnUrl).startsWith('https://')
      ? returnUrl
      : 'https://thegridgaming.fun/book?order_id={order_id}';
  }
  if (notifyUrl && String(notifyUrl).startsWith('https://')) {
    payload.order_meta.notify_url = notifyUrl;
  }

  const response = await fetch(`${config.baseUrl}/orders`, {
    method: 'POST',
    headers: getCashfreeHeaders(config),
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.payment_session_id) {
    console.error('Cashfree Create Order Error:', data);
    throw new Error(
      data.message || 'Failed to initialize Cashfree payment session'
    );
  }

  return {
    orderId: data.order_id,
    cfOrderId: data.cf_order_id,
    paymentSessionId: data.payment_session_id,
    orderStatus: data.order_status,
    sdkMode: config.sdkMode,
  };
}

/**
 * Verifies a Cashfree order status directly from Cashfree's server API
 */
async function verifyCashfreeOrder(orderId) {
  const config = getCashfreeConfig();
  if (!config.isConfigured) {
    throw new Error('Cashfree credentials are not configured');
  }

  const encodedOrderId = encodeURIComponent(orderId);
  const headers = getCashfreeHeaders(config);

  const [orderRes, paymentsRes] = await Promise.all([
    fetch(`${config.baseUrl}/orders/${encodedOrderId}`, {
      method: 'GET',
      headers,
    }),
    fetch(`${config.baseUrl}/orders/${encodedOrderId}/payments`, {
      method: 'GET',
      headers,
    }),
  ]);

  const orderData = await orderRes.json().catch(() => ({}));
  const paymentsData = await paymentsRes.json().catch(() => []);

  if (!orderRes.ok) {
    throw new Error(
      orderData.message || `Unable to fetch Cashfree order ${orderId}`
    );
  }

  const paymentsList = Array.isArray(paymentsData) ? paymentsData : [];
  const successfulPayment = paymentsList.find(
    (p) => p.payment_status === 'SUCCESS'
  );

  const isPaid =
    orderData.order_status === 'PAID' || Boolean(successfulPayment);

  return {
    isPaid,
    orderStatus: orderData.order_status || 'ACTIVE',
    cfPaymentId: successfulPayment?.cf_payment_id
      ? String(successfulPayment.cf_payment_id)
      : '',
    paymentGroup: successfulPayment?.payment_group || '',
    paymentTime: successfulPayment?.payment_completion_time || null,
    orderAmount: orderData.order_amount,
    orderData,
  };
}

/**
 * Verifies Cashfree Webhook Signature (HMAC-SHA256 of timestamp + rawBody in base64)
 */
function verifyCashfreeWebhookSignature(signature, rawBody, timestamp) {
  if (!signature || !rawBody || !timestamp) return false;
  const config = getCashfreeConfig();
  const secretsToTry = [config.webhookSecret, config.secretKey].filter(Boolean);

  for (const secret of secretsToTry) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(String(timestamp) + String(rawBody))
      .digest('base64');

    if (expected === signature) {
      return true;
    }
  }
  return false;
}

module.exports = {
  getCashfreeConfig,
  createCashfreeOrder,
  verifyCashfreeOrder,
  verifyCashfreeWebhookSignature,
};
