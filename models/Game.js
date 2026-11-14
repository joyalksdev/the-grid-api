// backend/models/Game.js
const mongoose = require('mongoose');

const GAME_MODES = ['Single', 'Dual', 'Triple', 'Big', 'SimDrive', 'GTA6_Launch'];
const GAME_PLATFORMS = ['PS5', 'SimDrive', 'PC'];

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, default: '' },
    publicId: { type: String, default: '' }, // Cloudinary public_id (Games/<slug>/<type>)
  },
  { _id: false }
);

const gameSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, unique: true, trim: true },
    // Stable folder key for Cloudinary (Games/<slug>). Never changes after creation.
    slug: { type: String, required: true, unique: true, index: true },
    genre: { type: String, required: true, trim: true }, // e.g., Action, Racing, Sports
    description: { type: String, default: '', trim: true, maxlength: 500 },
    platform: { type: String, enum: GAME_PLATFORMS, default: 'PS5' },

    // Images
    thumbnail: { type: imageSchema, default: () => ({}) }, // Landscape 16:9 (cards / banners)
    cover: { type: imageSchema, default: () => ({}) }, // Portrait 3:4 (poster art)

    // Play configuration
    supportedModes: {
      type: [{ type: String, enum: GAME_MODES }],
      default: ['Single'],
    },
    recommendedMode: { type: String, enum: GAME_MODES, default: 'Single' },
    minPlayers: { type: Number, min: 1, max: 4, default: 1 },
    maxPlayers: { type: Number, min: 1, max: 4, default: 1 },

    // Station links
    availableScreens: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Screen' }],
    assignedHardware: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hardware' }],

    // Visibility
    isFeatured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Backwards-compatible alias for older code that reads `coverUrl`
gameSchema.virtual('coverUrl').get(function getCoverUrl() {
  return this.cover?.url || '';
});

gameSchema.index({ isActive: 1, isFeatured: -1, title: 1 });

const Game = mongoose.model('Game', gameSchema);

module.exports = Game;
module.exports.GAME_MODES = GAME_MODES;
module.exports.GAME_PLATFORMS = GAME_PLATFORMS;
