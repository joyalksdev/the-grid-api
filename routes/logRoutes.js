const express = require('express');
const router = express.Router();

const {
  createLog,
  getLogs,
  getMetrics,
  getLogsByPlayer,
  updateLog,
  deleteLog
} = require('../controllers/logController');

router.post('/', createLog);
router.get('/', getLogs);
router.get('/metrics', getMetrics);
router.get('/player/:playerName', getLogsByPlayer);
router.put('/:id', updateLog);
router.delete('/:id', deleteLog);

module.exports = router;