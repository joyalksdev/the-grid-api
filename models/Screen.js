const mongoose = require('mongoose');

/**
 * Session schema embedded within Screen
 * Represents an active gaming session
 */
const sessionSchema = new mongoose.Schema({
  player: {
    type: String,
    required: true
  },
  mode: {
    type: String,
    enum: ['Single', 'Dual', 'Triple', 'Big', 'SimDrive'], // Added 'Triple'
    required: true
  },
  playersCount: {
    type: Number,
    default: 1
  },
  duration: {
    type: Number,
    required: true
  },
  estimatedCost: {
    type: Number,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  }
}, { _id: false });

/**
 * Screen schema
 * Represents a gaming station/terminal
 */
const ScreenSchema = new mongoose.Schema({
  screenId: {
    type: Number,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['Console', 'SimDrive'],
    required: true
  },
  status: {
    type: String,
    enum: ['available', 'occupied'],
    default: 'available'
  },
  activeSession: {
    type: sessionSchema,
    default: null
  }
}, {
  timestamps: false
});

// Secondary indexes for performance
ScreenSchema.index({ status: 1 });

const Screen = mongoose.model('Screen', ScreenSchema);

module.exports = Screen;