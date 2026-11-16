// backend/controllers/customerController.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const Booking = require('../models/Booking');
const { normalizeIndianMobile } = require('../services/fast2smsService');
const { sendCustomerOtpEmail } = require('../config/mailer');
const { formatSafePublicTicket } = require('../utils/bookingHelpers');

// In-memory 5-minute TTL store for Customer Email OTP verification
// key: lowercase email -> { otp, mode, phone, name, expiresAt }
const emailOtpStore = new Map();
const EMAIL_OTP_TTL_MS = 5 * 60 * 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// @desc    Step 1: Check if customer email exists; if so, immediately send Login OTP via Nodemailer
// @route   POST /api/public/auth/check-email
const checkCustomerEmail = async (req, res) => {
  try {
    const cleanEmail = String(req.body.email || '')
      .trim()
      .toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({
        error: 'Please enter a valid email address.',
      });
    }

    const existingCustomer = await Customer.findOne({ email: cleanEmail });

    if (existingCustomer) {
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      emailOtpStore.set(cleanEmail, {
        otp: otpCode,
        mode: 'login',
        phone: existingCustomer.phoneNumber,
        name: existingCustomer.name,
        expiresAt: Date.now() + EMAIL_OTP_TTL_MS,
      });

      const result = await sendCustomerOtpEmail({
        to: cleanEmail,
        otp: otpCode,
        isNewUser: false,
      });

      return res.json({
        success: true,
        exists: true,
        email: cleanEmail,
        message: 'Verification code sent to your email.',
        channel: result.channel,
      });
    }

    return res.json({
      success: true,
      exists: false,
      email: cleanEmail,
    });
  } catch (error) {
    console.error('Check Customer Email Error:', error.message);
    res.status(500).json({
      error: 'Failed to check email address. Please try again.',
    });
  }
};

// @desc    Step 2B: Send Nodemailer OTP for New User Registration (or Resend OTP)
// @route   POST /api/public/auth/send-email-otp
const sendEmailRegistrationOtp = async (req, res) => {
  try {
    const { email, phone, name } = req.body;
    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({
        error: 'Please enter a valid email address.',
      });
    }

    const existingCustomer = await Customer.findOne({ email: cleanEmail });
    const mobile10 = normalizeIndianMobile(
      phone || existingCustomer?.phoneNumber || ''
    );

    if (!existingCustomer && (!mobile10 || mobile10.length !== 10)) {
      return res.status(400).json({
        error: 'Please enter a valid 10-digit WhatsApp mobile number.',
      });
    }

    const fallbackName =
      cleanEmail
        .split('@')[0]
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Grid Player';

    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    emailOtpStore.set(cleanEmail, {
      otp: otpCode,
      mode: existingCustomer ? 'login' : 'register',
      phone: mobile10 ? `+91 ${mobile10}` : existingCustomer?.phoneNumber,
      name: String(name || existingCustomer?.name || fallbackName).trim(),
      expiresAt: Date.now() + EMAIL_OTP_TTL_MS,
    });

    const result = await sendCustomerOtpEmail({
      to: cleanEmail,
      otp: otpCode,
      isNewUser: !existingCustomer,
    });

    res.json({
      success: true,
      email: cleanEmail,
      message: 'Verification code sent to your email.',
      channel: result.channel,
    });
  } catch (error) {
    console.error('Send Email Registration OTP Error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to send verification email.',
    });
  }
};

// @desc    Verify 6-digit Email OTP, Login or Create Customer, & Return JWT
// @route   POST /api/public/auth/verify-email-otp
const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp, phone, name } = req.body;
    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(otp || '').trim();

    if (!cleanEmail || !cleanOtp || cleanOtp.length < 6) {
      return res.status(400).json({
        error: 'Email and 6-digit verification code are required.',
      });
    }

    const record = emailOtpStore.get(cleanEmail);
    if (!record || record.expiresAt < Date.now()) {
      emailOtpStore.delete(cleanEmail);
      return res.status(400).json({
        error: 'Verification code has expired. Please request a new code.',
      });
    }

    if (record.otp !== cleanOtp) {
      return res.status(400).json({
        error: 'Invalid verification code. Please check and try again.',
      });
    }

    emailOtpStore.delete(cleanEmail);

    const mobile10 = normalizeIndianMobile(phone || record.phone || '');
    const fallbackName =
      cleanEmail
        .split('@')[0]
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Grid Player';
    const cleanName = String(name || record.name || fallbackName).trim();

    let customer = await Customer.findOne({ email: cleanEmail });

    if (customer) {
      if (mobile10 && mobile10.length === 10 && !customer.phoneNumber) {
        customer.phoneNumber = `+91 ${mobile10}`;
      }
      customer.lastVisit = new Date();
      await customer.save();
    } else {
      if (!mobile10 || mobile10.length !== 10) {
        return res.status(400).json({
          error: 'A valid 10-digit WhatsApp number is required to register.',
        });
      }

      const formattedPhone = `+91 ${mobile10}`;
      const phoneRegex = new RegExp(mobile10.split('').join('\\s*'));
      customer = await Customer.findOne({
        $or: [
          { phoneNumber: formattedPhone },
          { phoneNumber: mobile10 },
          { phoneNumber: phoneRegex },
        ],
      });

      if (customer) {
        customer.email = cleanEmail;
        if (!customer.name || customer.name === 'Grid Player') {
          customer.name = cleanName;
        }
        customer.lastVisit = new Date();
        await customer.save();
      } else {
        customer = await Customer.create({
          name: cleanName,
          email: cleanEmail,
          phoneNumber: formattedPhone,
          totalVisits: 0,
          lastVisit: new Date(),
        });
      }
    }

    const token = jwt.sign(
      {
        customerId: customer._id,
        email: customer.email,
        phone: customer.phoneNumber,
        role: 'customer',
      },
      process.env.JWT_SECRET || 'grid_arena_customer_secret',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        _id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phoneNumber,
        totalVisits: customer.totalVisits || 0,
        createdAt: customer.createdAt,
      },
    });
  } catch (error) {
    console.error('Verify Email OTP Error:', error.message);
    res.status(500).json({
      error: 'Failed to verify code. Please try again.',
    });
  }
};

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
        email: customer.email,
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
        email: customer.email,
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
  checkCustomerEmail,
  sendEmailRegistrationOtp,
  verifyEmailOtp,
  searchCustomers,
  protectCustomer,
  getCustomerProfile,
  updateCustomerProfile,
};
