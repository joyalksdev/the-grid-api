// backend/controllers/fast2smsController.js
const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const {
  normalizeIndianMobile,
  sendOtpViaFast2SMS,
} = require('../services/fast2smsService');

// In-memory 5-minute TTL store for Customer OTP verification
// key: 10-digit mobile -> { otp, name, expiresAt }
const customerOtpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

// @desc    Send 6-digit OTP to customer via Fast2SMS WhatsApp / SMS
// @route   POST /api/public/auth/send-otp
const sendCustomerOtp = async (req, res) => {
  try {
    const { phone, name = 'Grid Player' } = req.body;
    const mobile = normalizeIndianMobile(phone);

    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({
        error: 'Please enter a valid 10-digit WhatsApp mobile number.',
      });
    }

    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    customerOtpStore.set(mobile, {
      otp: otpCode,
      name: String(name || 'Grid Player').trim(),
      expiresAt: Date.now() + OTP_TTL_MS,
    });

    const result = await sendOtpViaFast2SMS(mobile, otpCode, name);

    res.json({
      success: true,
      message: 'Verification code sent successfully',
      channel: result.channel,
      ...(result.channel === 'dev_console' ? { devOtp: otpCode } : {}),
    });
  } catch (error) {
    console.error('Send Customer OTP Error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to send verification code',
    });
  }
};

// @desc    Verify 6-digit OTP & return Customer JWT
// @route   POST /api/public/auth/verify-otp
const verifyCustomerOtp = async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    const mobile = normalizeIndianMobile(phone);
    const cleanOtp = String(otp || '').trim();

    if (!mobile || mobile.length !== 10 || !cleanOtp) {
      return res.status(400).json({
        error: 'Phone number and 6-digit verification code are required.',
      });
    }

    const record = customerOtpStore.get(mobile);
    if (!record || record.expiresAt < Date.now()) {
      customerOtpStore.delete(mobile);
      return res.status(400).json({
        error: 'Verification code has expired. Please request a new code.',
      });
    }

    if (record.otp !== cleanOtp) {
      return res.status(400).json({
        error: 'Invalid verification code. Please check and try again.',
      });
    }

    customerOtpStore.delete(mobile);

    const formattedPhone = `+91 ${mobile}`;
    const cleanName = String(name || record.name || 'Grid Player').trim();

    let customer = await Customer.findOne({
      $or: [{ phoneNumber: formattedPhone }, { phoneNumber: mobile }],
    });

    if (customer) {
      if (cleanName && cleanName !== 'Grid Player') {
        customer.name = cleanName;
        await customer.save();
      }
    } else {
      customer = await Customer.create({
        name: cleanName,
        phoneNumber: formattedPhone,
        totalVisits: 0,
        lastVisit: new Date(),
      });
    }

    const token = jwt.sign(
      {
        customerId: customer._id,
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
        phone: customer.phoneNumber,
        totalVisits: customer.totalVisits || 0,
        createdAt: customer.createdAt,
      },
    });
  } catch (error) {
    console.error('Verify Customer OTP Error:', error.message);
    res.status(500).json({ error: 'Failed to verify code' });
  }
};

module.exports = {
  sendCustomerOtp,
  verifyCustomerOtp,
};
