  // backend/controllers/pricingController.js
const PricingConfig = require('../models/PricingConfig');
const { getActivePricingConfig, DEFAULT_MATRIX } = require('../services/pricingService');
const { getIO } = require('../socket');

const getPricing = async (req, res, next) => {
  try {
    const config = await getActivePricingConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
};

const updatePricingMatrix = async (req, res, next) => {
  try {
    const { matrix } = req.body;
    if (!matrix) {
      return res.status(400).json({ error: 'Matrix payload is required' });
    }

    let config = await getActivePricingConfig();
    config.matrix = matrix;
    config.updatedBy = req.user?._id;
    await config.save();

    getIO().emit('pricing_updated', config);
    res.json({ message: 'Pricing rates updated successfully', config });
  } catch (error) {
    next(error);
  }
};

const createOffer = async (req, res, next) => {
  try {
    const offerData = req.body;
    let config = await getActivePricingConfig();

    config.offers.push(offerData);
    config.updatedBy = req.user?._id;
    await config.save();

    getIO().emit('pricing_updated', config);
    res.status(201).json({ message: 'Offer created successfully', config });
  } catch (error) {
    next(error);
  }
};

const updateOffer = async (req, res, next) => {
  try {
    const { offerId } = req.params;
    let config = await getActivePricingConfig();

    const offer = config.offers.id(offerId);
    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    Object.assign(offer, req.body);
    config.updatedBy = req.user?._id;
    await config.save();

    getIO().emit('pricing_updated', config);
    res.json({ message: 'Offer updated successfully', config });
  } catch (error) {
    next(error);
  }
};

const deleteOffer = async (req, res, next) => {
  try {
    const { offerId } = req.params;
    let config = await getActivePricingConfig();

    config.offers.pull(offerId);
    config.updatedBy = req.user?._id;
    await config.save();

    getIO().emit('pricing_updated', config);
    res.json({ message: 'Offer deleted successfully', config });
  } catch (error) {
    next(error);
  }
};


const resetPricingToDefaults = async (req, res, next) => {
  try {
    let config = await PricingConfig.findOne().sort({ updatedAt: -1 });
    if (!config) {
      config = new PricingConfig();
    }

    config.matrix = DEFAULT_MATRIX;
    config.offers = [];
    config.updatedBy = req.user?._id;
    await config.save();

    // Broadcast reset configuration live to all connected screens
    getIO().emit('pricing_updated', config);

    res.json({ message: 'Pricing matrix reset to default system rates', config });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPricing,
  updatePricingMatrix,
  createOffer,
  updateOffer,
  deleteOffer,
  resetPricingToDefaults,
};