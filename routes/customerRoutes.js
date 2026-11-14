// backend/routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const {
  searchCustomers,
  protectCustomer,
  getCustomerProfile,
  updateCustomerProfile,
} = require('../controllers/customerController');
const { protect } = require('../middleware/authMiddleware');

// Admin autocomplete search
router.route('/search').get(protect, searchCustomers);

// Customer self-service profile & passes endpoints
router.get('/me', protectCustomer, getCustomerProfile);
router.put('/profile', protectCustomer, updateCustomerProfile);

module.exports = router;
