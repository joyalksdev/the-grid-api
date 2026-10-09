// routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { getDashboardAnalytics } = require('../controllers/analyticsController');

// Require authentication and restrict strictly to Owners/Admins
router.use(protect);
router.use(authorizeRoles('admin', 'owner'));

/**
 * @route   GET /api/analytics
 * @desc    Get aggregated business, hardware, and task analytics
 */
router.get('/', getDashboardAnalytics);

module.exports = router;