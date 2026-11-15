// backend/controllers/bookingController.js
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Screen = require('../models/Screen');
const Customer = require('../models/Customer');
const { getIO } = require('../socket');
const { sendTicketViaFast2SMS } = require('../services/fast2smsService');
const { to24HourTime, to12HourTime } = require('../utils/bookingHelpers');

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
      query.status = status;
    } else {
      // Hide unpaid online checkout drafts until payment is confirmed
      query.$or = [
        { source: { $ne: 'online' } },
        { paymentStatus: 'paid' },
        { status: { $in: ['confirmed', 'checked_in', 'completed', 'cancelled', 'refunded'] } },
      ];
    }
    if (screenId) query.screen = screenId;
    if (station && station !== 'all') query.station = station;

    const bookings = await Booking.find(query)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits')
      .sort({ date: -1, startTime: 1 });
      
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
      estimatedCost,
      amountPaid,
      utr,
      selectedGames, 
      notes 
    } = req.body;

    if (!customerName || !phoneNumber || !screenId || !date || !startTime || !duration) {
      return res.status(400).json({ error: 'Please fill in all required booking fields (Player Name, Phone, Station, Date, Time & Duration)' });
    }

    const targetScreen = await Screen.findById(screenId);
    if (!targetScreen) {
      return res.status(404).json({ error: 'Assigned screen/station not found' });
    }

    const normalizedStart = to24HourTime(startTime);
    const durNum = Number(duration);

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

    // Determine total paid amount (from amountPaid or estimatedCost)
    const finalAmount = Number(
      amountPaid !== undefined && amountPaid !== null && amountPaid !== ''
        ? amountPaid
        : estimatedCost
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
      mode: mode || 'Single',
      date,
      startTime: normalizedStart,
      duration: durNum,
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

const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    booking.status = status || booking.status;
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
  updateBookingStatus,
  refundBooking,
  resendTicket,
  deleteBooking,
};
