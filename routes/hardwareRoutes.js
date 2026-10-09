// routes/hardwareRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getDevices,
  createDevice,
  updateDevice,
  createServiceLog,
  getAllServiceLogs,
  updateServiceLog,
} = require('../controllers/hardwareController');

router.use(protect);

router.route('/')
  .get(getDevices)
  .post(createDevice);

router.route('/:id')
  .put(updateDevice);

router.post('/:id/service', createServiceLog);

router.get('/service-logs/all', getAllServiceLogs);
router.put('/service-logs/:logId', updateServiceLog);

module.exports = router;