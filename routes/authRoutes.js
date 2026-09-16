// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { login, register, logout, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', login);
router.post('/register', register);
router.post('/logout', logout);
router.get('/me', protect, getMe);

module.exports = router;