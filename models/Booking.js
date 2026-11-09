// backend/models/Booking.js
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    customerName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    screen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Screen',
      required: true,
    },
    station: { type: String, required: true }, // Cached name e.g., "Screen 1", "SimDrive"
    mode: { type: String, default: 'Single' },  // e.g., "Single", "Dual", "SimDrive"
    date: { type: String, required: true },    // Format: "YYYY-MM-DD"
    startTime: { type: String, required: true }, // Format: "HH:mm" (e.g., "14:30")
    duration: { type: Number, required: true },  // Duration in minutes (e.g., 60)
    selectedGames: { type: [String], default: [] }, // Array of selected game titles
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'checked_in', 'cancelled', 'completed'],
      default: 'confirmed',
    },
    notes: { type: String, default: '' },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdByName: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Booking', bookingSchema);