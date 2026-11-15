// backend/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/bookingController');
const { protect } = require('../middleware/authMiddleware');

// GTA 6 Launch Manual Option 1 Public Endpoint (unprotected)
router.post('/gta6-manual', createGta6ManualBooking);

router.route('/')
  .get(protect, getBookings)  
  .post(protect, createBooking);

// Route to fetch bookings grouped/filtered by screen ID
router.route('/screen/:screenId')
  .get(protect, getBookingsByScreen);

router.route('/:id/status')
  .patch(protect, updateBookingStatus);

router.route('/:id/extend')
  .patch(protect, extendBooking)
  .post(protect, extendBooking);

// Staff / Admin Approve & Mark Paid (fires Fast2SMS ticket)
router.route('/:id/approve')
  .patch(protect, approveBooking)
  .post(protect, approveBooking);

router.route('/:id/refund')
  .post(protect, refundBooking)
  .patch(protect, refundBooking);

router.route('/:id/resend-ticket')
  .post(protect, resendTicket);

router.route('/:id')
  .delete(protect, deleteBooking);

module.exports = router;
