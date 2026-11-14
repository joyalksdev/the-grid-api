// backend/controllers/customerController.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const Booking = require('../models/Booking');
const { normalizeIndianMobile } = require('../services/fast2smsService');
const { formatSafePublicTicket } = require('../utils/bookingHelpers');

// @desc    Search customers by name or phone number for Admin autocomplete
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

// @desc    Middleware to authenticate Customer JWT (with verified phone fallback)
const protectCustomer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token && token !== 'null' && token !== 'undefined') {
        try {
          const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET || 'grid_arena_customer_secret'
          );
          const customerById = await Customer.findById(decoded.customerId);
          if (customerById) {
            req.customer = customerById;
            return next();
          }
        } catch (_) {
          // Fall through to phone lookup if token expired or secret changed
        }
      }
    }

    // Fallback: resolve customer by phone query/body if user session exists in localStorage
    const rawPhone = req.query.phone || req.body?.phone || '';
    const mobile10 = normalizeIndianMobile(rawPhone);
    if (mobile10 && mobile10.length === 10) {
      const phoneRegex = new RegExp(mobile10.split('').join('\\s*'));
      let customer = await Customer.findOne({ phoneNumber: phoneRegex });
      if (!customer) {
        customer = await Customer.create({
          name: req.body?.name || 'Grid Player',
          phoneNumber: `+91 ${mobile10}`,
          totalVisits: 0,
          lastVisit: new Date(),
        });
      }
      req.customer = customer;
      return next();
    }

    return res.status(401).json({ error: 'Authentication required' });
  } catch (err) {
    return res
      .status(401)
      .json({ error: 'Session expired. Please sign in again.' });
  }
};

// @desc    Get logged-in player's profile + their confirmed/completed bookings
// @route   GET /api/public/auth/me | GET /api/customers/me
const getCustomerProfile = async (req, res) => {
  try {
    const customer = req.customer;
    const mobile10 = normalizeIndianMobile(customer.phoneNumber);
    const phoneMatchClause =
      mobile10 && mobile10.length === 10
        ? [
            { customer: customer._id },
            { phoneNumber: new RegExp(mobile10.split('').join('\\s*')) },
          ]
        : [{ customer: customer._id }, { phoneNumber: customer.phoneNumber }];

    const rawBookings = await Booking.find({
      $and: [
        { $or: phoneMatchClause },
        {
          $or: [
            { source: { $ne: 'online' } },
            { paymentStatus: 'paid' },
            {
              status: {
                $in: ['confirmed', 'checked_in', 'completed', 'cancelled'],
              },
            },
          ],
        },
      ],
    })
      .populate('screen', 'screenId name type status')
      .sort({ date: -1, startTime: -1 });

    // Ensure any legacy booking without a ticketToken gets one persisted
    const bookings = [];
    for (const b of rawBookings) {
      if (!b.ticketToken) {
        b.ticketToken = crypto.randomBytes(24).toString('hex');
        await b.save().catch(() => {});
      }
      bookings.push(formatSafePublicTicket(b, b.screen));
    }

    res.json({
      user: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phoneNumber,
        totalVisits: customer.totalVisits || bookings.length,
        lastVisit: customer.lastVisit,
        createdAt: customer.createdAt,
      },
      bookings,
    });
  } catch (error) {
    console.error('Get Customer Profile Error:', error.message);
    res.status(500).json({ error: 'Failed to load player profile' });
  }
};

// @desc    Update logged-in player's display name
// @route   PUT /api/public/auth/profile | PUT /api/customers/profile
const updateCustomerProfile = async (req, res) => {
  try {
    const customer = req.customer;
    const cleanName = String(req.body.name || '').trim();

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({
        error: 'Please enter a valid name (at least 2 characters).',
      });
    }

    customer.name = cleanName;
    await customer.save();

    // Sync customerName on their upcoming bookings as well
    await Booking.updateMany(
      { customer: customer._id, status: { $in: ['confirmed', 'pending'] } },
      { $set: { customerName: cleanName } }
    ).catch(() => {});

    res.json({
      success: true,
      user: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phoneNumber,
        totalVisits: customer.totalVisits || 0,
        lastVisit: customer.lastVisit,
        createdAt: customer.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

module.exports = {
  searchCustomers,
  protectCustomer,
  getCustomerProfile,
  updateCustomerProfile,
};
