// backend/routes/pricingRoutes.js
const express = require('express');
const router = express.Router();
const { getPricing, updatePricing } = require('../controllers/pricingController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

router.use(protect); // All pricing endpoints require authentication

router.get('/', getPricing);
router.put('/', authorizeRoles('admin'), updatePricing); // Strictly restricted to admin

module.exports = router;