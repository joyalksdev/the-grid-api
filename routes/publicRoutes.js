// backend/routes/publicRoutes.js
const express = require('express');
const router = express.Router();

const {
  getPublicConfig,
  getPublicAvailability,
  calculatePublicPrice,
  createPublicBooking,
  getPublicTicket,
} = require('../controllers/publicController');

const {
  createPaymentOrder,
  verifyPaymentOrder,
  handleCashfreeWebhook,
} = require('../controllers/cashfreeController');

const {
  sendCustomerOtp,
  verifyCustomerOtp,
} = require('../controllers/fast2smsController');

const {
  protectCustomer,
  getCustomerProfile,
  updateCustomerProfile,
} = require('../controllers/customerController');

// Public Lounge Config, Availability & Ticket Routes
router.get('/config', getPublicConfig);
router.get('/availability', getPublicAvailability);
router.post('/calculate-price', calculatePublicPrice);
router.post('/bookings', createPublicBooking);
router.get('/ticket/:token', getPublicTicket);

// Cashfree Payment Gateway Routes (cashfreeController)
router.post('/payment/create-order', createPaymentOrder);
router.post('/payment/verify', verifyPaymentOrder);
router.post('/payment/webhook', handleCashfreeWebhook);

// Fast2SMS WhatsApp / SMS OTP Routes (fast2smsController)
router.post('/auth/send-otp', sendCustomerOtp);
router.post('/auth/verify-otp', verifyCustomerOtp);

// Customer Profile & Bookings Routes (customerController)
router.get('/auth/me', protectCustomer, getCustomerProfile);
router.put('/auth/profile', protectCustomer, updateCustomerProfile);

module.exports = router;
