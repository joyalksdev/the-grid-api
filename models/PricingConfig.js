// backend/models/PricingConfig.js
const mongoose = require('mongoose');

// Use a flexible Map-like schema definition or allow mixed types for dynamic duration keys
const DurationRatesSchema = new mongoose.Schema(
  {},
  { _id: false, strict: false }
);

const ModePricingSchema = new mongoose.Schema(
  {
    sessions: { type: mongoose.Schema.Types.Mixed, required: true },
    extensions: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false, strict: false }
);

const OfferSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    code: { type: String, uppercase: true, trim: true },
    discountType: { 
      type: String, 
      enum: ['percentage', 'flat'], 
      required: true,
      default: 'percentage' 
    },
    discountValue: { type: Number, required: true, default: 0 },
    applicableModes: [{ type: String }],
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    daysOfWeek: [{ type: Number }],
    startTime: { type: String, default: '00:00' },
    endTime: { type: String, default: '23:59' },
    isActive: { type: Boolean, default: true },
  },
  { _id: true, timestamps: true, strict: false }
);

const pricingConfigSchema = new mongoose.Schema(
  {
    matrix: {
      Single: { type: ModePricingSchema, required: true },
      Dual: { type: ModePricingSchema, required: true },
      Triple: { type: ModePricingSchema, required: true },
      Big: { type: ModePricingSchema, required: true },
      SimDrive: { type: ModePricingSchema, required: true },
    },
    offers: [OfferSchema],
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);