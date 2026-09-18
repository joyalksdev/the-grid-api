// backend/controllers/pricingController.js
const PricingConfig = require('../models/PricingConfig');
const { DEFAULT_PRICING_MATRIX } = require('../config/pricing');
const { getIO } = require('../socket');

const getPricing = async (req, res) => {
  try {
    let config = await PricingConfig.findOne().sort({ updatedAt: -1 });

    if (!config) {
      config = await PricingConfig.create({
        matrix: DEFAULT_PRICING_MATRIX,
      });
    }

    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pricing config' });
  }
};

const updatePricing = async (req, res) => {
  try {
    const { matrix } = req.body;

    if (!matrix) {
      return res.status(400).json({ error: 'Matrix payload is required' });
    }

    let config = await PricingConfig.findOne().sort({ updatedAt: -1 });

    if (config) {
      config.matrix = matrix;
      config.updatedBy = req.user?._id;
      await config.save();
    } else {
      config = await PricingConfig.create({
        matrix,
        updatedBy: req.user?._id,
      });
    }

    // Broadcast updated matrix real-time across connected clients
    getIO().emit('pricing_updated', config);

    res.json({ message: 'Pricing rates updated successfully', config });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update pricing config' });
  }
};

module.exports = { getPricing, updatePricing };