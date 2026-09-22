const mongoose = require('mongoose');

const DurationRatesSchema = new mongoose.Schema(
  {
    15: { type: Number, required: true },
    30: { type: Number, required: true },
    60: { type: Number, required: true },
  },
  { _id: false }
);

const ModePricingSchema = new mongoose.Schema(
  {
    sessions: { type: DurationRatesSchema, required: true },
    extensions: { type: DurationRatesSchema, required: true },
  },
  { _id: false }
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
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);