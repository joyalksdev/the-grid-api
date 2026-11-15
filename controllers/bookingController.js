// backend/controllers/bookingController.js
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Screen = require('../models/Screen');
const Customer = require('../models/Customer');
const { getIO, lockSlot, releaseSlotLock } = require('../socket');
const { sendTicketViaFast2SMS } = require('../services/fast2smsService');
const { calculateSessionCost, getActivePricingConfig } = require('../services/pricingService');
const { createAndEmitNotification } = require('./notificationController');
const {
  to24HourTime,
  to12HourTime,
  toScreenCode,
  resolveTargetScreen,
} = require('../utils/bookingHelpers');

function timeToMinutes(timeStr) {
  const normalized = to24HourTime(timeStr);
  const [hours, minutes] = normalized.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function checkTimeOverlap(start1, dur1, start2, dur2) {
  const s1 = timeToMinutes(start1);
  const e1 = s1 + Number(dur1);
  const s2 = timeToMinutes(start2);
  const e2 = s2 + Number(dur2);

  return Math.max(s1, s2) < Math.min(e1, e2);
}

const getBookings = async (req, res) => {
  try {
    const { date, status, screenId, station } = req.query;
    const query = {};

    if (date) query.date = date;
    if (status) {
      if (status === 'pending_whatsapp') {
        query.status = 'pending';
      } else {
        query.status = status;
      }
    } else {
      // Hide unpaid online checkout drafts until payment is confirmed, but allow pending WhatsApp bookings
      query.$or = [
        { source: { $in: ['walk_in', 'manual_admin', 'gta6_manual'] } },
        { paymentStatus: 'paid' },
        { status: { $in: ['confirmed', 'checked_in', 'completed', 'cancelled', 'refunded', 'pending'] } },
      ];
    }
    if (screenId) query.screen = screenId;
    if (station && station !== 'all') query.station = station;

    const bookings = await Booking.find(query)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits')
      .sort({ createdAt: -1, date: -1, startTime: 1 });
      
    res.json(bookings);
  } catch (error) {
    console.error('Fetch bookings error:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

const getBookingsByScreen = async (req, res) => {
  try {
    const { screenId } = req.params;
    const { date } = req.query;

    const query = { screen: screenId };
    if (date) query.date = date;

    const bookings = await Booking.find(query)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits')
      .sort({ date: 1, startTime: 1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings for this screen' });
  }
};

const createBooking = async (req, res) => {
  try {
    const { 
      customerName, 
      phoneNumber, 
      screenId, 
      mode, 
      date, 
      startTime, 
      duration, 
      baseSessionDuration,
      extensionDuration,
      estimatedCost,
      amountPaid,
      utr,
      selectedGames, 
      notes 
    } = req.body;

    if (!customerName || !phoneNumber || !screenId || !date || !startTime || (!duration && !baseSessionDuration)) {
      return res.status(400).json({ error: 'Please fill in all required booking fields (Player Name, Phone, Station, Date, Time & Duration)' });
    }

    const targetScreen = await Screen.findById(screenId);
    if (!targetScreen) {
      return res.status(404).json({ error: 'Assigned screen/station not found' });
    }

    const normalizedStart = to24HourTime(startTime);
    const extDur = Math.max(0, Number(extensionDuration || 0));
    const baseDur = Number(baseSessionDuration || (Number(duration) > extDur ? Number(duration) - extDur : duration) || 60);
    const durNum = baseSessionDuration ? baseDur + extDur : Number(duration);

    // Upsert Customer profile
    let customer = await Customer.findOne({ phoneNumber });
    if (customer) {
      customer.name = customerName;
      customer.totalVisits += 1;
      customer.lastVisit = new Date();
      await customer.save();
    } else {
      customer = await Customer.create({
        name: customerName,
        phoneNumber,
        totalVisits: 1,
        lastVisit: new Date(),
      });
    }

    const existingBookings = await Booking.find({
      screen: screenId,
      date,
      status: { $in: ['confirmed', 'checked_in'] },
    });

    for (const b of existingBookings) {
      if (checkTimeOverlap(normalizedStart, durNum, b.startTime, b.duration)) {
        return res.status(400).json({
          error: `Station ${targetScreen.name} is already booked from ${b.startTime} for ${b.duration} mins.`,
        });
      }
    }

    // Calculate DB-synced pricing if not overridden
    const selectedMode = mode || 'Single';
    const dbBaseCost = await calculateSessionCost(selectedMode, baseDur, false);
    const dbExtCost = extDur > 0 ? await calculateSessionCost('GTA6_Launch', extDur, true) : 0;
    const dbSyncedTotal = dbBaseCost + dbExtCost;

    // Determine total paid amount (from amountPaid, estimatedCost, or DB pricingService)
    const finalAmount = Number(
      amountPaid !== undefined && amountPaid !== null && amountPaid !== ''
        ? amountPaid
        : estimatedCost !== undefined && estimatedCost !== null && estimatedCost !== ''
        ? estimatedCost
        : dbSyncedTotal
    ) || 0;

    const ticketToken = crypto.randomBytes(24).toString('hex'); // 48-char secure hex token
    const bookingCode = `GRID-${Math.floor(100000 + Math.random() * 900000)}`;

    const booking = await Booking.create({
      bookingCode,
      customer: customer._id,
      customerName: customerName.trim(),
      phoneNumber: phoneNumber.trim(),
      screen: targetScreen._id,
      station: targetScreen.name,
      mode: selectedMode,
      date,
      startTime: normalizedStart,
      duration: durNum,
      extensionDuration: extDur,
      baseAmount: finalAmount,
      taxAmount: 0,
      convenienceFee: 0,
      totalAmount: finalAmount,
      estimatedCost: finalAmount,
      selectedGames: Array.isArray(selectedGames) ? selectedGames : [],
      notes: notes || '',
      source: 'manual_admin',
      paymentStatus: 'paid',
      status: 'confirmed',
      utr: utr ? String(utr).trim() : '',
      ticketToken,
      createdBy: req.user?._id || null,
      createdByName: req.user?.name || req.user?.username || 'Admin Staff',
    });

    const populatedBooking = await Booking.findById(booking._id)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits');

    // Trigger Real-time Sockets
    const io = getIO();
    if (io) {
      io.emit('booking_created', populatedBooking);
    }

    // Instantly trigger the Fast2SMS WhatsApp utility template (booking_ticket_confirmed)
    const stationLabel = targetScreen.name || 'Screen 1';
    const slot12 = to12HourTime(normalizedStart);

    sendTicketViaFast2SMS({
      phone: booking.phoneNumber,
      customerName: booking.customerName,
      bookingCode: booking.bookingCode,
      screenLabel: stationLabel,
      station: stationLabel,
      mode: booking.mode,
      date: booking.date,
      slot: slot12,
      duration: booking.duration,
      totalAmount: booking.totalAmount,
      ticketToken: booking.ticketToken,
    }).catch((err) => {
      console.error('Fast2SMS ticket utility dispatch error on admin booking:', err?.message || err);
    });

    res.status(201).json(populatedBooking);
  } catch (error) {
    console.error('Failed to create admin booking:', error);
    res.status(500).json({ error: error.message || 'Failed to create booking' });
  }
};

/**
 * Temporary Option 1 Manual Booking Flow for GTA 6 Launch
 * Generates short readable Order ID (e.g. #GRID-882), sets status 'pending',
 * locks slot for 15 minutes to prevent sniping, and dynamically calculates pricing.
 */
const createGta6ManualBooking = async (req, res) => {
  try {
    const {
      customerName,
      email,
      phoneNumber,
      screen,
      screenId,
      screenCode,
      date,
      startTime,
      baseSessionDuration,
      duration = 60,
      extensionDuration = 0,
      notes,
    } = req.body;

    if (!phoneNumber || !date || !startTime) {
      return res.status(400).json({
        error: 'Please provide Phone Number, Date and Time slot.',
      });
    }

    const cleanPhone = String(phoneNumber).replace(/\D/g, '').slice(-10);
    if (cleanPhone.length < 10) {
      return res.status(400).json({
        error: 'Please enter a valid 10-digit Indian phone number.',
      });
    }

    const cleanEmail = email ? String(email).trim().toLowerCase() : undefined;
    const fallbackName = cleanEmail
      ? cleanEmail
          .split('@')[0]
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Grid Player';
    const finalCustomerName = String(customerName || fallbackName).trim();

    const resolvedScreenCode = screenCode || screen || 'Screen1';
    if (String(resolvedScreenCode).toLowerCase() === 'screen3') {
      return res.status(400).json({
        error: 'GTA 6 is restricted to Screen 1 and Screen 2.',
      });
    }

    const targetScreen = await resolveTargetScreen({
      screenId,
      screenCode: resolvedScreenCode,
    });
    if (!targetScreen) {
      return res.status(404).json({ error: 'Selected screen not found.' });
    }

    const normalizedStart = to24HourTime(startTime);
    const baseDuration = Number(baseSessionDuration || duration) || 60;
    const extDuration = Number(extensionDuration) || 0;
    const totalDuration = baseDuration + extDuration;

    // Fetch exact pricing for GTA6_Launch sessions and extensions dynamically from pricingService
    const baseCost = await calculateSessionCost('GTA6_Launch', baseDuration, false);
    const extensionCost = extDuration > 0
      ? await calculateSessionCost('GTA6_Launch', extDuration, true)
      : 0;
    const totalAmount = baseCost + extensionCost;

    // Overlap check: check against confirmed, checked_in, AND unexpired pending bookings
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const existingBookings = await Booking.find({
      screen: targetScreen._id,
      date,
      $or: [
        { status: { $in: ['confirmed', 'checked_in'] } },
        {
          status: 'pending',
          $or: [
            { expiresAt: { $gt: new Date() } },
            { createdAt: { $gt: cutoff } },
          ],
        },
      ],
    });

    for (const b of existingBookings) {
      if (checkTimeOverlap(normalizedStart, totalDuration, b.startTime, b.duration)) {
        return res.status(400).json({
          error: `Slot ${to12HourTime(normalizedStart)} on ${targetScreen.name} is already held or booked. Please choose another time.`,
        });
      }
    }

    // Upsert Customer profile
    const phoneRegex = new RegExp(cleanPhone.split('').join('\\s*'));
    let customer = await Customer.findOne({
      $or: [
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
        { phoneNumber: cleanPhone },
        { phoneNumber: `+91 ${cleanPhone}` },
        { phoneNumber: phoneRegex },
      ],
    });
    if (customer) {
      if (finalCustomerName && finalCustomerName !== 'Grid Player') {
        customer.name = finalCustomerName;
      }
      if (cleanEmail && !customer.email) {
        customer.email = cleanEmail;
      }
      customer.lastVisit = new Date();
      await customer.save();
    } else {
      customer = await Customer.create({
        name: finalCustomerName,
        ...(cleanEmail ? { email: cleanEmail } : {}),
        phoneNumber: `+91 ${cleanPhone}`,
        totalVisits: 1,
        lastVisit: new Date(),
      });
    }

    // Short readable Order ID (e.g. #GRID-882)
    const orderNum = Math.floor(100 + Math.random() * 900);
    const orderId = `#GRID-${orderNum}`;
    const bookingCode = `GRID-${Math.floor(100000 + Math.random() * 900000)}`;
    const ticketToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

    const booking = await Booking.create({
      bookingCode,
      orderId,
      customer: customer._id,
      customerName: customer.name || finalCustomerName,
      phoneNumber: cleanPhone,
      screen: targetScreen._id,
      station: targetScreen.name,
      mode: 'GTA6_Launch',
      date,
      startTime: normalizedStart,
      duration: totalDuration,
      baseSessionDuration: baseDuration,
      extensionDuration: extDuration,
      baseAmount: baseCost,
      extensionCost,
      taxAmount: 0,
      convenienceFee: 0,
      totalAmount,
      estimatedCost: totalAmount,
      selectedGames: ['Grand Theft Auto VI'],
      notes: notes
        ? `${notes} (GTA 6 Launch Pass · Base ${baseDuration}m + Ext ${extDuration}m)`
        : `GTA 6 Launch Pass (Manual WhatsApp Flow · Base ${baseDuration}m + Ext ${extDuration}m)`,
      source: 'gta6_manual',
      paymentStatus: 'unpaid',
      status: 'pending',
      expiresAt,
      ticketToken,
      createdByName: 'GTA 6 Manual Web Portal',
    });

    // Real-time slot locking via socket
    const scrCode = toScreenCode(targetScreen);
    lockSlot(scrCode, date, normalizedStart, 15 * 60 * 1000, totalDuration);

    const populatedBooking = await Booking.findById(booking._id)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name email phoneNumber totalVisits');

    try {
      const io = getIO();
      if (io) {
        io.emit('booking_created', populatedBooking);
        io.emit('slot_locked', {
          screenCode: scrCode,
          date,
          startTime: normalizedStart,
          duration: totalDuration,
        });
      }
    } catch (_) {}

    // Create & broadcast real-time staff/admin notification
    createAndEmitNotification({
      title: `New GTA 6 Slot Locked (${orderId})`,
      message: `${booking.customerName} locked ${targetScreen.name} for ${to12HourTime(normalizedStart)} on ${date} (${totalDuration}m · ₹${totalAmount}). Awaiting WhatsApp verification.`,
      type: 'booking_pending',
      priority: 'normal',
      actionUrl: `/booking?tab=pending_whatsapp`,
      metadata: {
        orderId,
        bookingId: booking._id,
        station: targetScreen.name,
        customerName: booking.customerName,
        phoneNumber: booking.phoneNumber,
        totalAmount,
        startTime: to12HourTime(normalizedStart),
        date,
      },
      createdByName: 'GTA 6 Web Portal',
    });

    res.status(201).json({
      ok: true,
      success: true,
      booking: populatedBooking,
      orderId,
      bookingId: booking._id,
      bookingCode: booking.bookingCode,
      ticketToken: booking.ticketToken,
      totalAmount,
      baseCost,
      extensionCost,
      duration: totalDuration,
      baseDuration,
      extensionDuration: extDuration,
      date: booking.date,
      startTime: booking.startTime,
      startTime12h: to12HourTime(normalizedStart),
      station: booking.station,
      screenCode: scrCode,
      expiresAt: booking.expiresAt,
      customerName: booking.customerName,
      phoneNumber: booking.phoneNumber,
    });
  } catch (error) {
    console.error('GTA 6 Manual Booking error:', error);
    res.status(500).json({ error: error.message || 'Failed to initialize GTA 6 slot hold' });
  }
};

/**
 * Approve & Mark Paid (Staff / Admin endpoint for WhatsApp Pending Bookings)
 * Changes status to 'confirmed', clears TTL expiration, and fires the Fast2SMS ticket.
 */
const approveBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id).populate('screen');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.status === 'confirmed') {
      return res.status(400).json({ error: 'Booking is already confirmed' });
    }

    booking.status = 'confirmed';
    booking.paymentStatus = 'paid';
    booking.expiresAt = null; // Clear TTL expiration so booking is permanent
    const staffName = req.user?.name || req.user?.username || 'Staff';
    booking.notes = booking.notes
      ? `${booking.notes}\n[Approved & Paid verified by ${staffName} on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}]`
      : `[Approved & Paid verified by ${staffName}]`;

    if (!booking.ticketToken) {
      booking.ticketToken = crypto.randomBytes(24).toString('hex');
    }

    await booking.save();

    const populatedBooking = await Booking.findById(booking._id)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits');

    // Trigger Real-time Sockets
    try {
      const io = getIO();
      if (io) {
        io.emit('booking_updated', populatedBooking);
      }
    } catch (_) {}

    // Create & broadcast approval notification
    createAndEmitNotification({
      title: `Booking Approved (${booking.orderId || booking.bookingCode})`,
      message: `${staffName} verified payment & confirmed ${booking.customerName} on ${booking.station} (${to12HourTime(to24HourTime(booking.startTime))}, ${booking.date}).`,
      type: 'booking_confirmed',
      priority: 'normal',
      actionUrl: `/booking?tab=active`,
      metadata: {
        orderId: booking.orderId,
        bookingId: booking._id,
        station: booking.station,
        customerName: booking.customerName,
      },
      createdBy: req.user?._id || null,
      createdByName: staffName,
    });

    // Instantly trigger the Fast2SMS WhatsApp utility ticket
    const stationLabel = populatedBooking.station || populatedBooking.screen?.name || 'Screen 1';
    const slot12 = to12HourTime(to24HourTime(booking.startTime));

    sendTicketViaFast2SMS({
      phone: booking.phoneNumber,
      customerName: booking.customerName,
      bookingCode: booking.bookingCode,
      screenLabel: stationLabel,
      station: stationLabel,
      mode: booking.mode,
      date: booking.date,
      slot: slot12,
      duration: booking.duration,
      totalAmount: booking.totalAmount,
      ticketToken: booking.ticketToken,
    }).catch((err) => {
      console.error('Fast2SMS ticket dispatch error on approval:', err?.message || err);
    });

    res.json({
      message: 'Booking approved and Fast2SMS WhatsApp ticket dispatched successfully',
      booking: populatedBooking,
    });
  } catch (error) {
    console.error('Error approving booking:', error);
    res.status(500).json({ error: error.message || 'Failed to approve booking' });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    booking.status = status || booking.status;
    if (status === 'confirmed') {
      booking.paymentStatus = 'paid';
      booking.expiresAt = null;
    }
    if (status === 'refunded') {
      booking.paymentStatus = 'refunded';
      if (!booking.refundDetails || !booking.refundDetails.refundedAt) {
        booking.refundDetails = {
          refundAmount: booking.totalAmount || booking.estimatedCost || 0,
          refundReason: 'Status updated to refunded',
          refundTransactionRef: booking.utr || '',
          refundedAt: new Date(),
          refundedBy: req.user?._id || null,
          refundedByName: req.user?.name || req.user?.username || 'Admin',
          notes: '',
        };
      }
    }

    await booking.save();

    const updatedBooking = await Booking.findById(booking._id)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits');

    const io = getIO();
    if (io) {
      io.emit('booking_updated', updatedBooking);
    }

    res.json(updatedBooking);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update booking status' });
  }
};

const refundBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { refundAmount, refundReason, refundTransactionRef, notes } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.status === 'refunded') {
      return res.status(400).json({ error: 'This booking has already been refunded.' });
    }

    const finalRefundAmount =
      refundAmount !== undefined && refundAmount !== null && refundAmount !== ''
        ? Number(refundAmount)
        : Number(booking.totalAmount || booking.estimatedCost || 0);

    booking.status = 'refunded';
    booking.paymentStatus = 'refunded';
    booking.refundDetails = {
      refundAmount: finalRefundAmount,
      refundReason: refundReason ? String(refundReason).trim() : 'Customer refund request',
      refundTransactionRef: refundTransactionRef ? String(refundTransactionRef).trim() : (booking.utr || ''),
      refundedAt: new Date(),
      refundedBy: req.user?._id || null,
      refundedByName: req.user?.name || req.user?.username || 'Admin Staff',
      notes: notes ? String(notes).trim() : '',
    };

    if (notes) {
      booking.notes = booking.notes
        ? `${booking.notes}\n[Refund Ref: ${refundTransactionRef || 'N/A'}]: ${notes}`
        : `[Refund Ref: ${refundTransactionRef || 'N/A'}]: ${notes}`;
    }

    await booking.save();

    const updatedBooking = await Booking.findById(booking._id)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits');

    const io = getIO();
    if (io) {
      io.emit('booking_updated', updatedBooking);
    }

    res.json({
      message: 'Booking marked as refunded successfully',
      booking: updatedBooking,
    });
  } catch (error) {
    console.error('Refund processing error:', error);
    res.status(500).json({ error: error.message || 'Failed to process refund' });
  }
};

const resendTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id).populate('screen');
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (!booking.ticketToken) {
      booking.ticketToken = crypto.randomBytes(24).toString('hex');
      await booking.save();
    }

    const stationLabel = booking.station || booking.screen?.name || 'Screen 1';
    const normalizedStart = to24HourTime(booking.startTime);
    const slot12 = to12HourTime(normalizedStart);

    const result = await sendTicketViaFast2SMS({
      phone: booking.phoneNumber,
      customerName: booking.customerName,
      bookingCode: booking.bookingCode,
      screenLabel: stationLabel,
      station: stationLabel,
      mode: booking.mode,
      date: booking.date,
      slot: slot12,
      duration: booking.duration,
      totalAmount: booking.totalAmount || booking.estimatedCost || 0,
      ticketToken: booking.ticketToken,
    });

    res.json({
      message: 'Fast2SMS WhatsApp ticket notification triggered successfully',
      result,
    });
  } catch (error) {
    console.error('Resend ticket error:', error);
    res.status(500).json({ error: error.message || 'Failed to resend ticket WhatsApp pass' });
  }
};

const extendBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { extensionMinutes, amountPaid, utr } = req.body;

    const addMins = Number(extensionMinutes || 0);
    if (!addMins || addMins <= 0) {
      return res.status(400).json({ error: 'Please select a valid extension duration (e.g. 15, 30, or 60 mins).' });
    }

    const booking = await Booking.findById(id).populate('screen');
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const newTotalDuration = Number(booking.duration || 60) + addMins;
    const normalizedStart = to24HourTime(booking.startTime);

    // Check overlap with other confirmed/checked_in bookings on the same screen and date
    const otherBookings = await Booking.find({
      _id: { $ne: booking._id },
      screen: booking.screen?._id || booking.screen,
      date: booking.date,
      status: { $in: ['confirmed', 'checked_in'] },
    });

    for (const b of otherBookings) {
      if (checkTimeOverlap(normalizedStart, newTotalDuration, b.startTime, b.duration)) {
        return res.status(400).json({
          error: `Cannot extend by ${addMins}m — conflicts with ${b.customerName}'s booking at ${b.startTime}.`,
        });
      }
    }

    // Calculate extension cost dynamically from DB pricingService (GTA6_Launch.extensions: 30m=130, 60m=230)
    const extCost = await calculateSessionCost('GTA6_Launch', addMins, true);

    const finalExtPaid =
      amountPaid !== undefined && amountPaid !== null && amountPaid !== ''
        ? Number(amountPaid)
        : extCost;

    booking.duration = newTotalDuration;
    booking.extensionDuration = Number(booking.extensionDuration || 0) + addMins;
    booking.baseAmount = Number(booking.baseAmount || 0) + finalExtPaid;
    booking.totalAmount = Number(booking.totalAmount || booking.estimatedCost || 0) + finalExtPaid;
    booking.estimatedCost = booking.totalAmount;
    if (utr) {
      booking.utr = booking.utr ? `${booking.utr}, ${String(utr).trim()}` : String(utr).trim();
    }
    const staffName = req.user?.name || req.user?.username || 'Staff';
    booking.notes = booking.notes
      ? `${booking.notes}\n[Extended +${addMins}m (+₹${finalExtPaid}) by ${staffName}]`
      : `[Extended +${addMins}m (+₹${finalExtPaid}) by ${staffName}]`;

    await booking.save();

    const updatedBooking = await Booking.findById(booking._id)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits');

    try {
      const io = getIO();
      if (io) {
        io.emit('booking_updated', updatedBooking);
      }
    } catch (_) {}

    res.json({
      message: `Extended session by +${addMins} mins (+₹${finalExtPaid})`,
      booking: updatedBooking,
    });
  } catch (error) {
    console.error('Extend booking error:', error);
    res.status(500).json({ error: error.message || 'Failed to extend booking' });
  }
};

const deleteBooking = async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const io = getIO();
    if (io) {
      io.emit('booking_deleted', { id: req.params.id });
    }

    res.json({ message: 'Booking deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete booking' });
  }
};

module.exports = {
  getBookings,
  getBookingsByScreen,
  createBooking,
  createGta6ManualBooking,
  approveBooking,
  updateBookingStatus,
  extendBooking,
  refundBooking,
  resendTicket,
  deleteBooking,
};
