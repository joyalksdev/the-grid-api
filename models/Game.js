// backend/models/Game.js
const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, unique: true },
    genre: { type: String, required: true }, // e.g., Action, Racing, Sports
    platform: { type: String, default: 'PS5' }, // e.g., PS5, SimDrive, PC
    coverUrl: { type: String, default: '' },
    availableScreens: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Screen',
      },
    ], // Linked directly to the Screen model
    assignedHardware: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hardware',
      },
    ], // Linked directly to the Hardware (PS5 Consoles/Peripherals) model
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Game', gameSchema);