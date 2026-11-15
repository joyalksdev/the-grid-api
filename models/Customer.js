// backend/models/Customer.js
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      index: true,
    },
    phoneNumber: { type: String, required: true, unique: true, index: true },
    totalVisits: { type: Number, default: 1 },
    lastVisit: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', customerSchema);