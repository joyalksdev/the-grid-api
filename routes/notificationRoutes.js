// backend/routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const {
  getNotifications,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
  acknowledgeNotification,
  deleteNotification,
} = require('../controllers/notificationController');

router.use(protect);

router.get('/', getNotifications);
router.post('/', authorizeRoles('admin', 'owner'), createNotification);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);
router.patch('/:id/acknowledge', acknowledgeNotification);
router.delete('/:id', authorizeRoles('admin', 'owner'), deleteNotification);

module.exports = router;
