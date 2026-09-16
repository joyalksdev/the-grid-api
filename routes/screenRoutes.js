// backend/routes/screenRoutes.js
// Routes for screen management

const express = require('express');
const router = express.Router();

const {
  getScreens,
  startSession,
  extendSession,
  checkoutSession
} = require('../controllers/screenController');

/**
 * @route   GET /api/screens
 * @desc    Get all screens with current status
 */
router.get('/', getScreens);

/**
 * @route   POST /api/screens/:id/start
 * @desc    Start a new session on a screen
 */
router.post('/:id/start', startSession);

/**
 * @route   POST /api/screens/:id/extend
 * @desc    Extend an existing session by 30 minutes
 */
router.post('/:id/extend', extendSession);

/**
 * @route   POST /api/screens/:id/checkout
 * @desc    Checkout a session and log the transaction
 */
router.post('/:id/checkout', checkoutSession);

module.exports = router;