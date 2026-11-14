// backend/services/pricingService.js
const PricingConfig = require('../models/PricingConfig');

const DEFAULT_MATRIX = {
  Single: {
    sessions: { 15: 50, 30: 90, 60: 160 },
    extensions: { 15: 50, 30: 80, 60: 130 }
  },
  Dual: {
    sessions: { 15: 80, 30: 140, 60: 250 },
    extensions: { 15: 80, 30: 120, 60: 190 }
  },
  Triple: {
    sessions: { 15: 100, 30: 180, 60: 310 },
    extensions: { 15: 100, 30: 160, 60: 270 }
  },
  Big: {
    sessions: { 15: 120, 30: 220, 60: 380 },
    extensions: { 15: 120, 30: 200, 60: 340 }
  },
  SimDrive: {
    sessions: { 15: 90, 30: 170, 60: 290 },
    extensions: { 15: 80, 30: 150, 60: 260 }
  },
  GTA6_Launch: {
    sessions: { 30: 150, 60: 250 },
    extensions: { 30: 130, 60: 230 }
  }
};

/**
 * Retrieves the active pricing configuration, seeding defaults if none exist.
 */
async function getActivePricingConfig() {
  let config = await PricingConfig.findOne().sort({ updatedAt: -1 });
  if (!config) {
    config = await PricingConfig.create({ matrix: DEFAULT_MATRIX, offers: [] });
  } else if (!config.matrix?.GTA6_Launch) {
    config.matrix = {
      ...DEFAULT_MATRIX,
      ...(config.matrix ? (config.matrix.toObject ? config.matrix.toObject() : config.matrix) : {}),
      GTA6_Launch: DEFAULT_MATRIX.GTA6_Launch,
    };
  }
  return config;
}

/**
 * Checks if an offer is currently valid based on date, time, day of week, and mode.
 */
function isOfferValid(offer, mode) {
  if (!offer.isActive) return false;

  if (offer.applicableModes && offer.applicableModes.length > 0) {
    if (!offer.applicableModes.includes(mode)) return false;
  }

  const now = new Date();

  if (offer.startDate && new Date(offer.startDate) > now) return false;
  if (offer.endDate && new Date(offer.endDate) < now) return false;

  if (offer.daysOfWeek && offer.daysOfWeek.length > 0) {
    if (!offer.daysOfWeek.includes(now.getDay())) return false;
  }

  if (offer.startTime && offer.endTime) {
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (currentTimeStr < offer.startTime || currentTimeStr > offer.endTime) {
      return false;
    }
  }

  return true;
}

/**
 * Calculates session cost dynamically using DB matrix and applying any valid automated offers.
 */
async function calculateSessionCost(mode, duration, isExtension = false) {
  const config = await getActivePricingConfig();
  const category = isExtension ? 'extensions' : 'sessions';
  
  const modePricing = config.matrix?.[mode];
  if (!modePricing || !modePricing[category] || !modePricing[category][duration]) {
    return 0;
  }

  let basePrice = modePricing[category][duration];

  // Evaluate active offers
  const activeOffers = (config.offers || []).filter((offer) => isOfferValid(offer, mode));

  let finalPrice = basePrice;
  for (const offer of activeOffers) {
    if (offer.discountType === 'percentage') {
      const discount = Math.round((basePrice * offer.discountValue) / 100);
      finalPrice = Math.max(0, finalPrice - discount);
    } else if (offer.discountType === 'flat') {
      finalPrice = Math.max(0, finalPrice - offer.discountValue);
    }
  }

  return finalPrice;
}

function getPlayersCount(mode) {
  if (mode === 'SimDrive' || mode === 'Single') return 1;
  if (mode === 'Dual') return 2;
  if (mode === 'Triple') return 3;
  if (mode === 'Big') return 4;
  return 1;
}

function getConvenienceFee() {
  const fee = process.env.CONVENIENCE_FEE;
  if (fee === undefined || fee === null || fee === '') return 15;
  const parsed = Number(fee);
  return Number.isNaN(parsed) ? 15 : parsed;
}

function getTaxPercent() {
  const pct = process.env.GST_PERCENT || process.env.TAX_PERCENT;
  if (pct === undefined || pct === null || pct === '') return 18;
  const parsed = Number(pct);
  return Number.isNaN(parsed) ? 18 : parsed;
}

/**
 * Itemizes the booking pricing breakdown:
 * - baseAmount: base session cost from matrix (after offers)
 * - gstPercent: applicable tax %
 * - taxAmount: rounded tax/GST amount
 * - convenienceFee: configurable online booking convenience fee (from env)
 * - totalAmount: sum of baseAmount + taxAmount + convenienceFee
 */
async function calculateBookingBreakdown(mode, duration, isExtension = false) {
  const baseAmount = await calculateSessionCost(mode, duration, isExtension);
  if (!baseAmount || baseAmount <= 0) {
    return {
      baseAmount: 0,
      gstPercent: 0,
      taxAmount: 0,
      convenienceFee: 0,
      totalAmount: 0,
    };
  }

  const gstPercent = getTaxPercent();
  const taxAmount = Math.round((baseAmount * gstPercent) / 100);
  const convenienceFee = getConvenienceFee();
  const totalAmount = baseAmount + taxAmount + convenienceFee;

  return {
    baseAmount,
    gstPercent,
    taxAmount,
    convenienceFee,
    totalAmount,
  };
}

module.exports = {
  getActivePricingConfig,
  calculateSessionCost,
  calculateBookingBreakdown,
  getConvenienceFee,
  getTaxPercent,
  getPlayersCount,
  DEFAULT_MATRIX,
};