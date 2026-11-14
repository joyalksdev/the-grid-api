// backend/controllers/bookingController.js
const Booking = require('../models/Booking');
const Screen = require('../models/Screen');
const Customer = require('../models/Customer');
const { getIO } = require('../socket');

function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function checkTimeOverlap(start1, dur1, start2, dur2) {
  const s1 = timeToMinutes(start1);
  const e1 = s1 + dur1;
  const s2 = timeToMinutes(start2);
  const e2 = s2 + dur2;

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
        { status: { $in: ['confirmed', 'checked_in', 'completed', 'cancelled'] } },
      ];
    }
    if (screenId) query.screen = screenId;
    if (station && station !== 'all') query.station = station;

    const bookings = await Booking.find(query)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits')
      .sort({ date: 1, startTime: 1 });
      
    res.json(bookings);
  } catch (error) {
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
      selectedGames, 
      notes 
    } = req.body;

    if (!customerName || !phoneNumber || !screenId || !date || !startTime || !duration) {
      return res.status(400).json({ error: 'Please fill in all required booking fields including screenId' });
    }

    if (!selectedGames || !Array.isArray(selectedGames) || selectedGames.length === 0) {
      return res.status(400).json({ error: 'Game selection is required for bookings.' });
    }

    const targetScreen = await Screen.findById(screenId);
    if (!targetScreen) {
      return res.status(404).json({ error: 'Assigned screen/station not found' });
    }

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
      if (checkTimeOverlap(startTime, Number(duration), b.startTime, b.duration)) {
        return res.status(400).json({
          error: `Station ${targetScreen.name} is already booked from ${b.startTime} for ${b.duration} mins.`,
        });
      }
    }

    const booking = await Booking.create({
      bookingCode: `GRID-${Math.floor(100000 + Math.random() * 900000)}`,
      customer: customer._id,
      customerName,
      phoneNumber,
      screen: targetScreen._id,
      station: targetScreen.name,
      mode: mode || 'Single',
      date,
      startTime,
      duration: Number(duration),
      baseAmount: Number(estimatedCost) || 0,
      taxAmount: 0,
      convenienceFee: 0,
      totalAmount: Number(estimatedCost) || 0,
      estimatedCost: Number(estimatedCost) || 0,
      selectedGames,
      notes,
      source: 'walk_in',
      createdBy: req.user._id,
      createdByName: req.user.name || req.user.username,
    });

    const populatedBooking = await Booking.findById(booking._id)
      .populate('screen', 'screenId name type status')
      .populate('customer', 'name phoneNumber totalVisits');

    const io = getIO();
    if (io) {
      io.emit('booking_created', populatedBooking);
    }

    res.status(201).json(populatedBooking);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create booking' });
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
  deleteBooking,
};