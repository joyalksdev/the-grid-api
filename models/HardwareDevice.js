// backend/models/Hardware.js
const mongoose = require('mongoose');

const hardwareSchema = new mongoose.Schema(
  {
    assetId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, 'Device name is required'],
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: ['Console', 'PC Setup', 'Audio', 'Display', 'Peripheral'],
    },
    station: {
      type: String,
      default: 'Storage / Spare',
      trim: true,
    },
    serialNumber: {
      type: String,
      required: [true, 'Serial number is required'],
      unique: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['active', 'maintenance', 'retired'],
      default: 'active',
    },
    image: {
      type: String,
      default: 'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?auto=format&fit=crop&w=400&q=80',
    },
    lastMaintenance: {
      type: Date,
      default: Date.now,
    },
    activeIssue: {
      category: { type: String },
      priority: { type: String, enum: ['low', 'medium', 'high'] },
      description: { type: String },
      reportedAt: { type: Date },
    },
    maintenanceHistory: [
      {
        resolutionType: { type: String },
        notes: { type: String },
        resolvedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Hardware', hardwareSchema);