const mongoose = require('mongoose');

/**
 * ActivityLog schema
 * Represents a completed gaming session transaction
 */
const ActivityLogSchema = new mongoose.Schema({
  logId: {
    type: String,
    required: true,
    unique: true
  },
  player: {
    type: String,
    required: true
  },
  screen: {
    type: String,
    required: true
  },
  duration: {
    type: String,
    required: true
  },
  cost: {
    type: Number,
    required: true
  },
  payment: {
    type: String,
    enum: ['Cash', 'UPI', 'UPI/GPay'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Secondary indexes for quick search and sorting
ActivityLogSchema.index({ timestamp: -1 });
ActivityLogSchema.index({ player: 1 });

const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);

module.exports = ActivityLog;