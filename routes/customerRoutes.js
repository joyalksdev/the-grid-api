// backend/routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const { searchCustomers } = require('../controllers/customerController');
const { protect } = require('../middleware/authMiddleware');

router.route('/search').get(protect, searchCustomers);

module.exports = router;