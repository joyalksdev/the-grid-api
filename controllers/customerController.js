// backend/controllers/customerController.js
const Customer = require('../models/Customer');

// @desc    Search customers by name or phone number for autocomplete
// @route   GET /api/customers/search
const searchCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) {
      return res.json([]);
    }

    const regex = new RegExp(q.trim(), 'i');
    const customers = await Customer.find({
      $or: [{ name: regex }, { phoneNumber: regex }],
    })
      .sort({ lastVisit: -1 })
      .limit(10);

    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search customers' });
  }
};

module.exports = {
  searchCustomers,
};