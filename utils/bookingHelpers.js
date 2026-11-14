// backend/utils/bookingHelpers.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const Screen = require('../models/Screen');
const Booking = require('../models/Booking');
const Customer = require('../models/Customer');
const { sendTicketViaFast2SMS } = require('../services/fast2smsService');
const { getIO, releaseSlotLock } = require('../socket');

// Convert "07:00 PM" or "19:00" -> "19:00" (24-hour HH:mm)
function to24HourTime(rawTime) {
  if (!rawTime) return '10:00';
  const trimmed = String(rawTime).trim();
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }
  const parts = trimmed.split(':');
  if (parts.length >= 2) {
    const h = String(parseInt(parts[0], 10) || 0).padStart(2, '0');
    const m = String(parseInt(parts[1], 10) || 0).padStart(2, '0');
    return `${h}:${m}`;
  }
  return '10:00';
}

// Convert "19:00" -> "07:00 PM"
function to12HourTime(time24) {
  if (!time24) return '';
  const [hStr, mStr] = String(time24).split(':');
  let hour = parseInt(hStr, 10);
  const minute = mStr || '00';
  if (isNaN(hour)) return time24;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${String(hour).padStart(2, '0')}:${minute} ${ampm}`;
}

function timeToMinutes(timeStr) {
  const normalized = to24HourTime(timeStr);
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours * 60 + minutes;
}

// Compute 24h and 12h end time from startTime + duration (mins)
function computeEndTime(startTimeStr, durationMins = 60) {
  const startMins = timeToMinutes(startTimeStr);
  const totalMins = (startMins + Number(durationMins || 60)) % (24 * 60);
  const endH = String(Math.floor(totalMins / 60)).padStart(2, '0');
  const endM = String(totalMins % 60).padStart(2, '0');
  const end24 = `${endH}:${endM}`;
  return {
    end24,
    end12: to12HourTime(end24),
  };
}

function checkTimeOverlap(start1, dur1, start2, dur2) {
  const s1 = timeToMinutes(start1);
  const e1 = s1 + dur1;
  const s2 = timeToMinutes(start2);
  const e2 = s2 + dur2;

  return Math.max(s1, s2) < Math.min(e1, e2);
}

// Map a Screen document to "Screen1" | "Screen2" | "Screen3"
function toScreenCode(screenDoc) {
  if (!screenDoc) return 'Screen1';
  if (screenDoc.screenId) return `Screen${screenDoc.screenId}`;
  const match = String(screenDoc.name || '').match(/(\d+)/);
  if (match) return `Screen${match[1]}`;
  if (screenDoc.type === 'SimDrive') return 'Screen3';
  return 'Screen1';
}

// Safe public ticket payload (never exposes phone numbers or internal payment secrets)
function formatSafePublicTicket(booking, screenDoc) {
  const scrCode = screenDoc
    ? toScreenCode(screenDoc)
    : booking.screen
    ? toScreenCode(booking.screen)
    : booking.station
    ? `Screen${(booking.station.match(/(\d+)/) || [null, '1'])[1]}`
    : 'Screen1';

  const stationName =
    booking.station || screenDoc?.name || booking.screen?.name || 'Screen 1';
  const normalizedStart = to24HourTime(booking.startTime);
  const start12 = to12HourTime(normalizedStart);
  const { end24, end12 } = computeEndTime(normalizedStart, booking.duration);

  return {
    ticketToken: booking.ticketToken || '',
    bookingCode: booking.bookingCode || '',
    bookingId: booking.bookingCode || '',
    customerName: booking.customerName || 'Grid Player',
    screen: stationName,
    screenCode: scrCode,
    mode: booking.mode || 'Single',
    duration: Number(booking.duration || 60),
    date: booking.date,
    startTime: start12,
    startTime24: normalizedStart,
    endTime: end12,
    endTime24: end24,
    baseAmount: Number(booking.baseAmount || 0),
    taxAmount: Number(booking.taxAmount || 0),
    convenienceFee: Number(booking.convenienceFee || 0),
    totalAmount: Number(
      booking.totalAmount !== undefined
        ? booking.totalAmount
        : booking.estimatedCost || 0
    ),
    price: Number(
      booking.totalAmount !== undefined
        ? booking.totalAmount
        : booking.estimatedCost || 0
    ),
    paymentStatus: booking.paymentStatus || 'paid',
    status: booking.status || 'confirmed',
    selectedGames: booking.selectedGames || [],
  };
}

// Ensure the 3 physical screens exist in MongoDB
async function ensureScreensExist() {
  let screens = await Screen.find().sort({ screenId: 1 });
  if (screens.length === 0) {
    screens = await Screen.insertMany([
      {
        screenId: 1,
        name: 'Screen 1',
        type: 'Console',
        status: 'available',
      },
      {
        screenId: 2,
        name: 'Screen 2',
        type: 'Console',
        status: 'available',
      },
      {
        screenId: 3,
        name: 'Screen 3',
        type: 'SimDrive',
        status: 'available',
      },
    ]);
  }
  return screens;
}

// Resolve a screen by MongoDB _id, screenCode ("Screen1"), screenId (1), or name ("Screen 1")
async function resolveTargetScreen({ screenId, screenCode }) {
  const screens = await ensureScreensExist();

  if (screenId && mongoose.Types.ObjectId.isValid(screenId)) {
    const byId = screens.find((s) => String(s._id) === String(screenId));
    if (byId) return byId;
  }

  const raw = String(screenCode || screenId || 'Screen1').trim();
  const numMatch = raw.match(/(\d+)/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    const byNum = screens.find(
      (s) => s.screenId === num || s.name.toLowerCase() === `screen ${num}`
    );
    if (byNum) return byNum;
  }

  return screens[0];
}

// Finalize a pending booking once payment is confirmed
async function finalizePaidBooking(booking, cfPaymentId = '') {
  const wasAlreadyConfirmed =
    booking.paymentStatus === 'paid' && booking.status === 'confirmed';

  if (!booking.ticketToken) {
    booking.ticketToken = crypto.randomBytes(24).toString('hex');
  }
  booking.paymentStatus = 'paid';
  booking.status = 'confirmed';
  if (cfPaymentId) {
    booking.paymentId = String(cfPaymentId);
  }
  await booking.save();

  const populatedBooking = await Booking.findById(booking._id)
    .populate('screen', 'screenId name type status')
    .populate('customer', 'name phoneNumber totalVisits');

  const resolvedScreenCode = toScreenCode(populatedBooking.screen);
  const normalizedStart = to24HourTime(booking.startTime);

  releaseSlotLock(resolvedScreenCode, booking.date, booking.startTime);
  releaseSlotLock(resolvedScreenCode, booking.date, normalizedStart);
  releaseSlotLock(
    resolvedScreenCode,
    booking.date,
    to12HourTime(normalizedStart)
  );

  if (!wasAlreadyConfirmed) {
    if (booking.customer) {
      await Customer.findByIdAndUpdate(booking.customer, {
        $inc: { totalVisits: 1 },
        $set: { lastVisit: new Date() },
      }).catch(() => {});
    }

    try {
      const io = getIO();
      if (io) {
        io.emit('booking_created', populatedBooking);
      }
    } catch (_) {
      // Socket not initialized
    }

    const stationLabel =
      populatedBooking.station || populatedBooking.screen?.name || 'Screen 1';
    sendTicketViaFast2SMS({
      phone: booking.phoneNumber,
      customerName: booking.customerName,
      bookingCode: booking.bookingCode,
      screenLabel: stationLabel,
      station: stationLabel,
      mode: booking.mode,
      date: booking.date,
      slot: to12HourTime(normalizedStart),
      duration: booking.duration,
      totalAmount:
        booking.totalAmount !== undefined
          ? booking.totalAmount
          : booking.estimatedCost || 0,
      ticketToken: booking.ticketToken,
    }).catch(() => {});
  }

  return populatedBooking;
}

module.exports = {
  to24HourTime,
  to12HourTime,
  timeToMinutes,
  computeEndTime,
  checkTimeOverlap,
  toScreenCode,
  formatSafePublicTicket,
  ensureScreensExist,
  resolveTargetScreen,
  finalizePaidBooking,
};
