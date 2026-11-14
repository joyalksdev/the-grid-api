// backend/controllers/cashfreeController.js
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const { calculateSessionCost, calculateBookingBreakdown } = require('../services/pricingService');
const { normalizeIndianMobile } = require('../services/fast2smsService');
const {
  createCashfreeOrder,
  verifyCashfreeOrder,
  verifyCashfreeWebhookSignature,
} = require('../services/cashfreeService');
const {
  to24HourTime,
  to12HourTime,
  checkTimeOverlap,
  formatSafePublicTicket,
  resolveTargetScreen,
  finalizePaidBooking,
} = require('../utils/bookingHelpers');

// @desc    Create a Cashfree payment order & pending booking
// @route   POST /api/public/payment/create-order
const createPaymentOrder = async (req, res) => {
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
      returnUrl,
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

    // Check against confirmed/checked_in bookings for overlap
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

    // Find or create customer profile
    const mobile10 = normalizeIndianMobile(cleanPhone);
    const formattedPhone =
      mobile10.length === 10 ? `+91 ${mobile10}` : cleanPhone;

    let customer = await Customer.findOne({
      $or: [
        { phoneNumber: formattedPhone },
        { phoneNumber: cleanPhone },
        { phoneNumber: mobile10 },
      ],
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

    const breakdown = await calculateBookingBreakdown(mode, durNum, false);
    const bookingCode = `GRID-${Math.floor(100000 + Math.random() * 900000)}`;
    const ticketToken = crypto.randomBytes(24).toString('hex');
    const orderId = `CF_${bookingCode.replace('-', '_')}_${Date.now()}`;

    const gamesArray =
      Array.isArray(selectedGames) && selectedGames.length > 0
        ? selectedGames
        : mode === 'GTA6_Launch'
        ? ['Grand Theft Auto VI']
        : ['Lounge Session'];

    const clientBaseUrl =
      process.env.CLIENT_URL || 'https://thegridgaming.fun';
    const finalReturnUrl =
      returnUrl ||
      `${clientBaseUrl.replace(/\/$/, '')}/book?order_id={order_id}`;

    const cfOrder = await createCashfreeOrder({
      orderId,
      amount: breakdown.totalAmount,
      customerId: customer._id,
      customerName: customer.name || cleanName,
      customerPhone: formattedPhone,
      returnUrl: finalReturnUrl,
      orderNote: `${bookingCode} | ${targetScreen.name} (${mode}) | Base: ₹${breakdown.baseAmount} + GST: ₹${breakdown.taxAmount} + Fee: ₹${breakdown.convenienceFee} = ₹${breakdown.totalAmount}`,
    });

    const booking = await Booking.create({
      bookingCode,
      ticketToken,
      customer: customer._id,
      customerName: customer.name || cleanName,
      phoneNumber: formattedPhone,
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
      paymentStatus: 'unpaid',
      orderId: cfOrder.orderId,
      status: 'pending',
      createdBy: null,
      createdByName: 'Online Website',
    });

    res.status(201).json({
      success: true,
      orderId: cfOrder.orderId,
      paymentSessionId: cfOrder.paymentSessionId,
      breakdown: {
        baseAmount: breakdown.baseAmount,
        taxAmount: breakdown.taxAmount,
        convenienceFee: breakdown.convenienceFee,
        totalAmount: breakdown.totalAmount,
      },
      sdkMode: cfOrder.sdkMode,
      bookingCode: booking.bookingCode,
      ticketToken: booking.ticketToken,
      amount: breakdown.totalAmount,
      estimatedCost: breakdown.totalAmount,
    });
  } catch (error) {
    console.error('Create Cashfree Order Error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to initiate payment order',
    });
  }
};

// @desc    Verify Cashfree order status & finalize booking
// @route   POST /api/public/payment/verify
const verifyPaymentOrder = async (req, res) => {
  try {
    const orderId = req.body.orderId || req.query.order_id;
    if (!orderId) {
      return res
        .status(400)
        .json({ error: 'Order ID is required for verification' });
    }

    const booking = await Booking.findOne({
      $or: [{ orderId }, { bookingCode: orderId }],
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking order not found' });
    }

    // If webhook already marked it paid, return immediately
    if (booking.paymentStatus === 'paid' && booking.status === 'confirmed') {
      const populated = await Booking.findById(booking._id)
        .populate('screen', 'screenId name type status')
        .populate('customer', 'name phoneNumber totalVisits');

      return res.json({
        verified: true,
        booking: populated,
        ticket: formatSafePublicTicket(populated, populated.screen),
      });
    }

    const verification = await verifyCashfreeOrder(booking.orderId);

    if (!verification.isPaid) {
      return res.status(400).json({
        verified: false,
        orderStatus: verification.orderStatus,
        error:
          verification.orderStatus === 'ACTIVE'
            ? 'Payment was cancelled or not completed. You can try again.'
            : `Payment status: ${verification.orderStatus}`,
      });
    }

    const populatedBooking = await finalizePaidBooking(
      booking,
      verification.cfPaymentId
    );

    res.json({
      verified: true,
      booking: populatedBooking,
      ticket: formatSafePublicTicket(populatedBooking, populatedBooking.screen),
    });
  } catch (error) {
    console.error('Verify Cashfree Order Error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to verify payment status',
    });
  }
};

// @desc    Cashfree server-to-server webhook
// @route   POST /api/public/payment/webhook
const handleCashfreeWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody = req.rawBody;

    if (signature && timestamp && rawBody) {
      const isValid = verifyCashfreeWebhookSignature(
        signature,
        rawBody,
        timestamp
      );
      if (!isValid) {
        console.warn('⚠️ Cashfree Webhook signature mismatch');
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }
    }

    const eventType = req.body?.type;
    const orderId = req.body?.data?.order?.order_id;
    const paymentStatus = req.body?.data?.payment?.payment_status;
    const cfPaymentId = req.body?.data?.payment?.cf_payment_id;

    if (
      orderId &&
      (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || paymentStatus === 'SUCCESS')
    ) {
      const booking = await Booking.findOne({ orderId });
      if (booking) {
        await finalizePaidBooking(booking, cfPaymentId);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Cashfree Webhook Error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = {
  createPaymentOrder,
  verifyPaymentOrder,
  handleCashfreeWebhook,
};
