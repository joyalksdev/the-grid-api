// models/Waitlist.js
const  mongoose = require('mongoose');

const waitlistSchema = new mongoose.Schema({
  contact: { type: String, required: true, trim: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Waitlist', waitlistSchema);