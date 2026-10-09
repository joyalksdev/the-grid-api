const mongoose = require('mongoose');

/**
 * ActivityLog Schema
 * Represents a completed gaming session transaction.
 */
const ActivityLogSchema = new mongoose.Schema(
  {
    logId: {
      type: String,
      required: true,
      unique: true
    },
    player: {
      type: String,
      required: true,
      trim: true
    },
    screen: {
      type: String,
      required: true,
      trim: true
    },
    duration: {
      type: String,
      required: true
    },
    cost: {
      type: Number,
      required: true,
      min: 0
    },
    payment: {
      type: String,
      enum: ['Cash', 'UPI', 'UPI/GPay', 'Card'],
      required: true
    },
    // Staff / Operator tracking fields
    loggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    operatorName: {
      type: String,
      trim: true,
      default: 'System Staff'
    },
    startTime: {
      type: Date
    },
    endTime: {
      type: Date
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Indexes for query performance
ActivityLogSchema.index({ timestamp: -1 });
ActivityLogSchema.index({ player: 1 });
ActivityLogSchema.index({ loggedBy: 1 });

const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);

module.exports = ActivityLog;