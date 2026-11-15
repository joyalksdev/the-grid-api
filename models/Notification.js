// backend/models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        'booking_pending',
        'booking_confirmed',
        'booking_expired',
        'announcement',
        'task',
        'hardware',
        'system',
      ],
      default: 'system',
    },
    priority: {
      type: String,
      enum: ['normal', 'important', 'critical'],
      default: 'normal',
    },
    // When true, pops up as a high-priority modal on Staff screens until acknowledged
    isModalPopup: {
      type: Boolean,
      default: false,
    },
    actionUrl: {
      type: String,
      default: '',
    },
    metadata: {
      type: Object,
      default: {},
    },
    readBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
      },
    ],
    acknowledgedBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        acknowledgedAt: { type: Date, default: Date.now },
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdByName: {
      type: String,
      default: 'System',
    },
  },
  { timestamps: true }
);

notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
