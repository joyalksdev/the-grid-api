// models/ServiceLog.js
const mongoose = require('mongoose');

const ServiceLogSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HardwareDevice',
      required: true,
    },
    tagId: {
      type: String,
      required: true,
      uppercase: true,
    },
    issueDescription: {
      type: String,
      required: [true, 'Issue description is required'],
      trim: true,
    },
    actionTaken: {
      type: String,
      trim: true,
      default: '',
    },
    servicedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    cost: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['reported', 'in_repair', 'resolved'],
      default: 'reported',
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ServiceLogSchema.index({ device: 1, status: 1 });

module.exports = mongoose.model('ServiceLog', ServiceLogSchema);