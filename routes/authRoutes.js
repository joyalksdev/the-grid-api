const express = require('express');
const router = express.Router();
const {
  login,
  register,
  logout,
  getMe,
  inviteUser,
  getInvites,
  revokeInvite,
  verifyInviteToken,
  completeOnboarding,
} = require('../controllers/authController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

// Auth Routes
router.post('/login', login);
router.post('/register', register);
router.post('/logout', logout);
router.get('/me', protect, getMe);

// Admin Invite Management Routes
router.post('/invite', protect, authorizeRoles('admin'), inviteUser);
router.get('/invites', protect, authorizeRoles('admin'), getInvites);
router.delete('/invites/:id', protect, authorizeRoles('admin'), revokeInvite);

// Public Onboarding Routes
router.get('/verify-invite/:token', verifyInviteToken);
router.post('/complete-onboarding', upload.single('avatar'), completeOnboarding);

module.exports = router;