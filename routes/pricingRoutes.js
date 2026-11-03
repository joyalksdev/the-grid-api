// backend/routes/pricingRoutes.js
const express = require('express');
const router = express.Router();
const {
  getPricing,
  updatePricingMatrix,
  createOffer,
  updateOffer,
  deleteOffer,
  resetPricingToDefaults,
} = require('../controllers/pricingController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getPricing);
router.put('/', authorizeRoles('admin'), updatePricingMatrix);
router.post('/reset', authorizeRoles('admin'), resetPricingToDefaults); // Reset endpoint

router.post('/offers', authorizeRoles('admin'), createOffer);
router.put('/offers/:offerId', authorizeRoles('admin'), updateOffer);
router.delete('/offers/:offerId', authorizeRoles('admin'), deleteOffer);

module.exports = router;