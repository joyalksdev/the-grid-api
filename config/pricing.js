// backend/config/pricing.js
const PRICING_MATRIX = {
  Single: {
    sessions: { 15: 50, 30: 90, 60: 160 },
    extensions: { 15: 50, 30: 80, 60: 130 }
  },
  Dual: {
    sessions: { 15: 80, 30: 140, 60: 250 },
    extensions: { 15: 80, 30: 120, 60: 190 }
  },
  Big: {
    sessions: { 15: 120, 30: 220, 60: 380 },
    extensions: { 15: 120, 30: 200, 60: 340 }
  },
  SimDrive: {
    sessions: { 15: 90, 30: 170, 60: 290 },
    extensions: { 15: 80, 30: 150, 60: 260 }
  }
};

const calculateSessionCost = (mode, duration, isExtension = false) => {
  const category = isExtension ? 'extensions' : 'sessions';
  const modePricing = PRICING_MATRIX[mode];

  if (!modePricing || !modePricing[category] || !modePricing[category][duration]) {
    return 0;
  }

  return modePricing[category][duration];
};

const getAvailableDurations = (mode) => {
  return [15, 30, 60];
};

const getPlayersCount = (mode) => {
  if (mode === 'SimDrive' || mode === 'Single') return 1;
  if (mode === 'Dual') return 2;
  if (mode === 'Big') return 4;
  return 1;
};

module.exports = {
  PRICING_MATRIX,
  calculateSessionCost,
  getAvailableDurations,
  getPlayersCount
};