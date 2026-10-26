// backend/routes/hardwareRoutes.js
const express = require('express');
const router = express.Router();
const {
  getHardware,
  createHardware,
  updateHardware,
  reportIssue,
  resolveIssue,
  deleteHardware,
} = require('../controllers/hardwareController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// All hardware endpoints require authentication
router.use(protect);

router.route('/')
  .get(getHardware)
  .post(authorizeRoles('admin', 'owner'), createHardware);

router.route('/:id')
  .put(authorizeRoles('admin', 'owner'), updateHardware)
  .delete(authorizeRoles('admin', 'owner'), deleteHardware);

router.route('/:id/issue').patch(reportIssue);
router.route('/:id/resolve').patch(resolveIssue);

module.exports = router;