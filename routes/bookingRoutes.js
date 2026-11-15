// backend/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const {
  getBookings,
  getBookingsByScreen,
  createBooking,
  updateBookingStatus,
  refundBooking,
  resendTicket,
  deleteBooking,
} = require('../controllers/bookingController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getBookings)  
  .post(protect, createBooking);

// Route to fetch bookings grouped/filtered by screen ID
router.route('/screen/:screenId')
  .get(protect, getBookingsByScreen);

router.route('/:id/status')
  .patch(protect, updateBookingStatus);

router.route('/:id/refund')
  .post(protect, refundBooking)
  .patch(protect, refundBooking);

router.route('/:id/resend-ticket')
  .post(protect, resendTicket);

router.route('/:id')
  .delete(protect, deleteBooking);

module.exports = router;
