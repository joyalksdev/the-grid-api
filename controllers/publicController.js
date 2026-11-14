// backend/controllers/publicController.js
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const Game = require('../models/Game');
const {
  getActivePricingConfig,
  calculateSessionCost,
  calculateBookingBreakdown,
  getConvenienceFee,
  getTaxPercent,
} = require('../services/pricingService');
const { getCashfreeConfig } = require('../services/cashfreeService');
const { getActiveSlotLocks } = require('../socket');
const {
  to24HourTime,
  to12HourTime,
  checkTimeOverlap,
  toScreenCode,
  formatSafePublicTicket,
  ensureScreensExist,
  resolveTargetScreen,
  finalizePaidBooking,
} = require('../utils/bookingHelpers');

// @desc    Get public lounge screens, pricing matrix, payment config & games
// @route   GET /api/public/config
const getPublicConfig = async (req, res) => {
  try {
    const [screens, pricingConfig, games] = await Promise.all([
      ensureScreensExist(),
      getActivePricingConfig(),
      Game.find({ isActive: { $ne: false } })
        .populate('availableScreens', 'screenId name type')
        .lean()
        .catch(() => []),
    ]);

    const cfConfig = getCashfreeConfig();

    res.json({
      screens: screens.map((s) => ({
        _id: s._id,
        screenId: s.screenId,
        code: toScreenCode(s),
        name: s.name,
        type: s.type,
        status: s.status,
      })),
      pricing: {
        matrix: pricingConfig.matrix,
        offers: (pricingConfig.offers || []).filter((o) => o.isActive),
      },
      paymentGateway: {
        provider: 'cashfree',
        enabled: cfConfig.isConfigured,
        mode: cfConfig.sdkMode,
      },
      charges: {
        convenienceFee: getConvenienceFee(),
        gstPercent: getTaxPercent(),
      },
      games,
    });
  } catch (error) {
    console.error('Public config error:', error);
    res.status(500).json({ error: 'Failed to load lounge configuration' });
  }
};

// @desc    Get booked and locked slots for a specific date
// @route   GET /api/public/availability?date=YYYY-MM-DD
const getPublicAvailability = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const [screens, bookings] = await Promise.all([
      ensureScreensExist(),
      Booking.find({
        date,
        status: { $in: ['confirmed', 'checked_in'] },
      })
        .populate('screen', 'screenId name type status')
        .sort({ startTime: 1 })
        .lean(),
    ]);

    const bookedSlots = bookings.map((b) => {
      const scrCode = b.screen
        ? toScreenCode(b.screen)
        : b.station
        ? `Screen${(b.station.match(/(\d+)/) || [null, '1'])[1]}`
        : 'Screen1';
      const time24 = to24HourTime(b.startTime);

      return {
        _id: b._id,
        screenId: b.screen?._id || b.screen,
        screenCode: scrCode,
        station: b.station || b.screen?.name || 'Screen 1',
        date: b.date,
        startTime: time24,
        startTime12h: to12HourTime(time24),
        duration: b.duration,
        status: b.status,
      };
    });

    const lockedSlots = getActiveSlotLocks(date).map((lock) => ({
      ...lock,
      startTime24h: to24HourTime(lock.startTime),
      startTime12h: to12HourTime(to24HourTime(lock.startTime)),
    }));

    const liveScreens = screens.map((s) => ({
      _id: s._id,
      screenId: s.screenId,
      screenCode: toScreenCode(s),
      name: s.name,
      status: s.status,
      activeUntil: s.activeSession?.endTime || null,
    }));

    res.json({
      date,
      bookedSlots,
      lockedSlots,
      liveScreens,
    });
  } catch (error) {
    console.error('Public availability error:', error);
    res.status(500).json({ error: 'Failed to load slot availability' });
  }
};

// @desc    Calculate session & extension price with full tax & fee breakdown
// @route   POST /api/public/calculate-price
const calculatePublicPrice = async (req, res) => {
  try {
    const { mode = 'Single', duration = 60 } = req.body;
    const durNum = Number(duration) || 60;
    const [breakdown, extensionPrice] = await Promise.all([
      calculateBookingBreakdown(mode, durNum, false),
      calculateSessionCost(mode, durNum, true),
    ]);

    res.json({
      mode,
      duration: durNum,
      baseAmount: breakdown.baseAmount,
      gstPercent: breakdown.gstPercent,
      taxAmount: breakdown.taxAmount,
      convenienceFee: breakdown.convenienceFee,
      totalAmount: breakdown.totalAmount,
      price: breakdown.totalAmount,
      basePrice: breakdown.baseAmount,
      extensionPrice,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate session price' });
  }
};

// @desc    Direct online booking creation (fallback endpoint)
// @route   POST /api/public/bookings
const createPublicBooking = async (req, res) => {
  try {
    const {
      customerName,
      phoneNumber,
      screenId,
      screenCode,
      mode = 'Single',
      date,
      startTime,
      duration = 60,
      selectedGames = [],
      notes = '',
    } = req.body;

    if (!phoneNumber || !date || !startTime || !duration) {
      return res.status(400).json({
        error:
          'Please select a screen, date, time slot, and enter your phone number.',
      });
    }

    const cleanName = (customerName || 'Grid Player').trim();
    const cleanPhone = String(phoneNumber).trim();
    const normalizedStartTime = to24HourTime(startTime);
    const durNum = Number(duration) || 60;

    if (mode === 'GTA6_Launch' && durNum === 15) {
      return res.status(400).json({
        error:
          'GTA 6 Launch Special is available in 30-minute and 60-minute sessions.',
      });
    }

    const targetScreen = await resolveTargetScreen({ screenId, screenCode });
    if (!targetScreen) {
      return res.status(404).json({ error: 'Selected screen not found' });
    }

    const existingBookings = await Booking.find({
      screen: targetScreen._id,
      date,
      status: { $in: ['confirmed', 'checked_in'] },
    });

    for (const b of existingBookings) {
      if (
        checkTimeOverlap(normalizedStartTime, durNum, b.startTime, b.duration)
      ) {
        return res.status(400).json({
          error: `${targetScreen.name} is already booked around ${to12HourTime(
            b.startTime
          )} (${b.duration} mins). Please pick another time slot.`,
        });
      }
    }

    let customer = await Customer.findOne({ phoneNumber: cleanPhone });
    if (customer) {
      if (cleanName && cleanName !== 'Grid Player') {
        customer.name = cleanName;
      }
      customer.totalVisits += 1;
      customer.lastVisit = new Date();
      await customer.save();
    } else {
      customer = await Customer.create({
        name: cleanName,
        phoneNumber: cleanPhone,
        totalVisits: 1,
        lastVisit: new Date(),
      });
    }

    const breakdown = await calculateBookingBreakdown(mode, durNum, false);
    const bookingCode = `GRID-${Math.floor(100000 + Math.random() * 900000)}`;
    const ticketToken = crypto.randomBytes(24).toString('hex');
    const gamesArray =
      Array.isArray(selectedGames) && selectedGames.length > 0
        ? selectedGames
        : mode === 'GTA6_Launch'
        ? ['Grand Theft Auto VI']
        : ['Lounge Session'];

    const booking = await Booking.create({
      bookingCode,
      ticketToken,
      customer: customer._id,
      customerName: customer.name || cleanName,
      phoneNumber: cleanPhone,
      screen: targetScreen._id,
      station: targetScreen.name,
      mode,
      date,
      startTime: normalizedStartTime,
      duration: durNum,
      baseAmount: breakdown.baseAmount,
      taxAmount: breakdown.taxAmount,
      convenienceFee: breakdown.convenienceFee,
      totalAmount: breakdown.totalAmount,
      estimatedCost: breakdown.totalAmount,
      selectedGames: gamesArray,
      notes: notes || 'Booked via thegridgaming.fun',
      source: 'online',
      paymentStatus: 'paid',
      status: 'confirmed',
      createdBy: null,
      createdByName: 'Online Website',
    });

    const populatedBooking = await finalizePaidBooking(booking);

    res.status(201).json({
      booking: populatedBooking,
      ticket: formatSafePublicTicket(populatedBooking, targetScreen),
    });
  } catch (error) {
    console.error('Create public booking error:', error);
    res.status(500).json({ error: 'Failed to create online booking' });
  }
};

// @desc    Public shareable digital pass endpoint (48-char hex ticketToken)
// @route   GET /api/public/ticket/:token
const getPublicTicket = async (req, res) => {
  try {
    const rawToken = String(req.params.token || '').trim();
    const isHexToken = /^[a-f0-9]{48}$/i.test(rawToken);

    if (!isHexToken) {
      return res.status(400).json({
        error: 'Invalid or expired pass link.',
      });
    }

    const booking = await Booking.findOne({
      ticketToken: rawToken.toLowerCase(),
      status: { $ne: 'pending' },
    })
      .populate('screen', 'screenId name type status')
      .lean();

    if (!booking) {
      return res.status(404).json({
        error: 'Digital pass not found or no longer active.',
      });
    }

    res.json(formatSafePublicTicket(booking, booking.screen));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load digital pass' });
  }
};

module.exports = {
  getPublicConfig,
  getPublicAvailability,
  calculatePublicPrice,
  createPublicBooking,
  getPublicTicket,
};
