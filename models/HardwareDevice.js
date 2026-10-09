// models/HardwareDevice.js
const mongoose = require('mongoose');

const HardwareDeviceSchema = new mongoose.Schema(
  {
    tagId: {
      type: String,
      required: [true, 'Tag ID sticker label is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Device name is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['controller', 'console', 'simrig', 'tv_display', 'headset', 'other'],
      required: true,
    },
    assignedScreen: {
      type: String,
      trim: true,
      default: 'Unassigned',
    },
    status: {
      type: String,
      enum: ['active', 'maintenance', 'repaired', 'decommissioned'],
      default: 'active',
    },
    condition: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'poor'],
      default: 'good',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    totalServiceCount: {
      type: Number,
      default: 0,
    },
    lastServicedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

HardwareDeviceSchema.index({ tagId: 1 });
HardwareDeviceSchema.index({ status: 1, type: 1 });

module.exports = mongoose.model('HardwareDevice', HardwareDeviceSchema);