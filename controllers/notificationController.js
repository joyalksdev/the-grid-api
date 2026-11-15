// backend/controllers/notificationController.js
const Notification = require('../models/Notification');
const { getIO } = require('../socket');

/**
 * Helper to create a notification in MongoDB and broadcast via Socket.IO
 */
const createAndEmitNotification = async ({
  title,
  message,
  type = 'system',
  priority = 'normal',
  isModalPopup = false,
  actionUrl = '',
  metadata = {},
  createdBy = null,
  createdByName = 'System',
}) => {
  try {
    const notification = await Notification.create({
      title,
      message,
      type,
      priority,
      isModalPopup: Boolean(isModalPopup),
      actionUrl,
      metadata,
      createdBy,
      createdByName,
      readBy: createdBy ? [{ user: createdBy, readAt: new Date() }] : [],
      acknowledgedBy: createdBy
        ? [{ user: createdBy, acknowledgedAt: new Date() }]
        : [],
    });

    try {
      const io = getIO();
      if (io) {
        io.emit('notification_created', notification);
      }
    } catch (_) {
      // Socket not yet initialized
    }

    return notification;
  } catch (err) {
    console.error('Error creating notification:', err.message);
    return null;
  }
};

// @desc    Get latest notifications for the authenticated user
// @route   GET /api/notifications
const getNotifications = async (req, res) => {
  try {
    const userId = String(req.user?._id || '');
    const items = await Notification.find({})
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();

    const formatted = items.map((n) => {
      const isRead = Array.isArray(n.readBy)
        ? n.readBy.some((r) => String(r.user) === userId)
        : false;
      const isAcknowledged = Array.isArray(n.acknowledgedBy)
        ? n.acknowledgedBy.some((a) => String(a.user) === userId)
        : false;

      return {
        ...n,
        isRead,
        isAcknowledged,
        readCount: Array.isArray(n.readBy) ? n.readBy.length : 0,
        acknowledgedCount: Array.isArray(n.acknowledgedBy)
          ? n.acknowledgedBy.length
          : 0,
      };
    });

    const unreadCount = formatted.filter((n) => !n.isRead).length;
    const unacknowledgedModals = formatted.filter(
      (n) =>
        (n.isModalPopup ||
          n.priority === 'important' ||
          n.priority === 'critical') &&
        n.type === 'announcement' &&
        !n.isAcknowledged
    );

    res.json({
      notifications: formatted,
      unreadCount,
      unacknowledgedModals,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

// @desc    Broadcast a new notification / announcement (Admin / Owner only)
// @route   POST /api/notifications
const createNotification = async (req, res) => {
  try {
    const {
      title,
      message,
      type = 'announcement',
      priority = 'normal',
      isModalPopup = false,
      actionUrl = '',
    } = req.body;

    if (!title || !message) {
      return res
        .status(400)
        .json({ error: 'Title and message are required.' });
    }

    const senderName = req.user?.name || req.user?.username || 'Admin';

    const notification = await createAndEmitNotification({
      title: String(title).trim(),
      message: String(message).trim(),
      type,
      priority,
      isModalPopup:
        Boolean(isModalPopup) ||
        priority === 'important' ||
        priority === 'critical',
      actionUrl: String(actionUrl || '').trim(),
      createdBy: req.user?._id || null,
      createdByName: senderName,
    });

    res.status(201).json(notification);
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to broadcast notification' });
  }
};

// @desc    Mark a single notification as read
// @route   PATCH /api/notifications/:id/read
const markNotificationRead = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { id } = req.params;

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const alreadyRead = notification.readBy.some(
      (r) => String(r.user) === String(userId)
    );
    if (!alreadyRead) {
      notification.readBy.push({ user: userId, readAt: new Date() });
      await notification.save();
    }

    res.json({ ok: true, id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

// @desc    Mark all notifications as read for current user
// @route   PATCH /api/notifications/read-all
const markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.user?._id;
    const unread = await Notification.find({
      'readBy.user': { $ne: userId },
    }).limit(100);

    await Promise.all(
      unread.map((n) => {
        n.readBy.push({ user: userId, readAt: new Date() });
        return n.save();
      })
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

// @desc    Acknowledge an Important Update Modal notification
// @route   PATCH /api/notifications/:id/acknowledge
const acknowledgeNotification = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { id } = req.params;

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const alreadyRead = notification.readBy.some(
      (r) => String(r.user) === String(userId)
    );
    if (!alreadyRead) {
      notification.readBy.push({ user: userId, readAt: new Date() });
    }

    const alreadyAck = notification.acknowledgedBy.some(
      (a) => String(a.user) === String(userId)
    );
    if (!alreadyAck) {
      notification.acknowledgedBy.push({
        user: userId,
        acknowledgedAt: new Date(),
      });
    }

    await notification.save();

    try {
      const io = getIO();
      if (io) {
        io.emit('notification_updated', notification);
      }
    } catch (_) {}

    res.json({ ok: true, id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to acknowledge notification' });
  }
};

// @desc    Delete a notification (Admin / Owner only)
// @route   DELETE /api/notifications/:id
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    await Notification.findByIdAndDelete(id);

    try {
      const io = getIO();
      if (io) {
        io.emit('notification_deleted', { id });
      }
    } catch (_) {}

    res.json({ ok: true, id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

module.exports = {
  createAndEmitNotification,
  getNotifications,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
  acknowledgeNotification,
  deleteNotification,
};
