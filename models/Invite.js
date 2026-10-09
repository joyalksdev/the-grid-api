const mongoose = require('mongoose');

const InviteSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    displayToken: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'staff', 'operator'],
      default: 'staff',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// MongoDB TTL Index: Automatically purges expired invite documents from the database
InviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Invite', InviteSchema);