// backend/models/Booking.js
const mongoose = require('mongoose');
const crypto = require('crypto');

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
    baseAmount: { type: Number, default: 0 }, // Session base price from matrix
    taxAmount: { type: Number, default: 0 }, // Applicable GST/tax
    convenienceFee: { type: Number, default: 0 }, // Configurable convenience fee
    totalAmount: { type: Number, default: 0 }, // Final payable amount (base + tax + fee)
    estimatedCost: { type: Number, default: 0 }, // Synced with totalAmount for backward compatibility
    bookingCode: { type: String, index: true },
    ticketToken: {
      type: String,
      unique: true,
      index: true,
      default: () => crypto.randomBytes(24).toString('hex'),
    },
    source: {
      type: String,
      enum: ['walk_in', 'online'],
      default: 'walk_in',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
    },
    orderId: { type: String, default: '' },
    paymentId: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'checked_in', 'cancelled', 'completed'],
      default: 'confirmed',
    },
    notes: { type: String, default: '' },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    createdByName: { type: String, default: 'Online Website' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Booking', bookingSchema);
