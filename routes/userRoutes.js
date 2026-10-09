const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser,
  updateUserProfile, // Controller function for updating own profile
} = require('../controllers/userController');
const { inviteUser } = require('../controllers/authController');

// ---------------------------------------------------------------------------
// 1. ALL ROUTES REQUIRE AUTHENTICATION
// ---------------------------------------------------------------------------
router.use(protect);

// ---------------------------------------------------------------------------
// 2. SELF-SERVICE / OPERATOR ROUTES (ANY AUTHENTICATED USER)
// ---------------------------------------------------------------------------
// @route   PUT /api/users/profile
// @desc    Update logged-in user's own profile info & avatar photo
// @access  Private (Admin & Operators)
router.put('/profile', upload.single('avatar'), updateUserProfile);

// ---------------------------------------------------------------------------
// 3. ADMIN-ONLY MANAGEMENT ROUTES
// ---------------------------------------------------------------------------
// Apply admin role restriction to all routes below this line
router.use(authorizeRoles('admin'));

// @route   GET /api/users
// @desc    Get all users list
// @route   POST /api/users
// @desc    Create a new user/staff member
router.route('/')
  .get(getUsers)
  .post(createUser);

// @route   GET /api/users/:id
// @desc    Get user by ID
// @route   PUT /api/users/:id
// @desc    Update user details by ID
// @route   DELETE /api/users/:id
// @desc    Delete user account
router.route('/:id')
  .get(getUserById)
  .put(updateUser)
  .delete(deleteUser);

// @route   PATCH /api/users/:id/status
// @desc    Toggle user status (Active / Inactive)
router.patch('/:id/status', toggleUserStatus);

// Admin Invite Trigger
router.post('/invite', authorizeRoles('admin'), inviteUser);

module.exports = router;