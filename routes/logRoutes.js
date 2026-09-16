// backend/routes/logRoutes.js
// Routes for activity logs and metrics

const express = require('express');
const router = express.Router();

const {
  getLogs,
  getMetrics,
  getLogsByPlayer
} = require('../controllers/logController');

/**
 * @route   GET /api/logs
 * @desc    Get all activity logs with optional search filter
 * @query   search - filter by player name or log ID
 */
router.get('/', getLogs);

/**
 * @route   GET /api/logs/metrics
 * @desc    Get aggregated metrics (total revenue and session count)
 */
router.get('/metrics', getMetrics);

/**
 * @route   GET /api/logs/player/:playerName
 * @desc    Get logs for a specific player
 */
router.get('/player/:playerName', getLogsByPlayer);

module.exports = router;