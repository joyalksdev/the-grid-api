// backend/controllers/userController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// @desc    Get all users / staff members
// @route   GET /api/users
// @access  Private/Admin
const getUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to fetch users' });
  }
};

// @desc    Get single user details
// @route   GET /api/users/:id
// @access  Private/Admin
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error fetching user' });
  }
};

// @desc    Create a new staff member / operator
// @route   POST /api/users
// @access  Private/Admin
const createUser = async (req, res) => {
  try {
    const { name, email, username, password, role, userId } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ message: 'Name, username, and password are required' });
    }

    // Check if username or email already exists
    const userExists = await User.findOne({
      $or: [
        { username: username.toLowerCase() },
        ...(email ? [{ email: email.toLowerCase() }] : [])
      ],
    });

    if (userExists) {
      return res.status(400).json({ message: 'Username or email already in use' });
    }

    // Auto-generate userId if not passed explicitly (e.g. USR-98213 or based on username)
    const generatedUserId = userId || `usr_${username.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Math.floor(1000 + Math.random() * 9000)}`;

    const user = await User.create({
      userId: generatedUserId,
      name,
      email: email ? email.toLowerCase() : undefined,
      username: username.toLowerCase(),
      password, // Pre-save hook in User model will auto-hash this safely
      role: role || 'operator',
      isActive: true,
    });

    res.status(201).json({
      _id: user._id,
      userId: user.userId,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create user' });
  }
};



// @desc    Update user details (Role, Name, Email)
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.name = req.body.name || user.name;
    user.email = req.body.email ? req.body.email.toLowerCase() : user.email;
    user.role = req.body.role || user.role;

    if (typeof req.body.isActive === 'boolean') {
      user.isActive = req.body.isActive;
    }

    // FIX: Remove manual bcrypt hashing to prevent double-hashing.
    // The pre-save hook in the User model will automatically catch this and hash it.
    if (req.body.password && req.body.password.trim() !== '') {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    res.status(200).json({
      _id: updatedUser._id,
      name: updatedUser.name,
      username: updatedUser.username,
      email: updatedUser.email,
      role: updatedUser.role,
      isActive: updatedUser.isActive,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update user' });
  }
};


// @desc    Toggle staff active/inactive status
// @route   PATCH /api/users/:id/status
// @access  Private/Admin
const toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      message: `User status changed to ${user.isActive ? 'active' : 'inactive'}`,
      isActive: user.isActive,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to toggle status' });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent deleting your own admin account
    if (user._id.toString() === req.user?._id?.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own logged-in account' });
    }

    await user.deleteOne();
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete user' });
  }
};

// @desc    Update current logged-in user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (req.body.name) user.name = req.body.name.trim();
    if (req.body.phone) user.phone = req.body.phone.trim();

    // Attach Cloudinary image URL if uploaded via Multer
    if (req.file && req.file.path) {
      user.photoUrl = req.file.path;
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      userId: updatedUser.userId,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      photoUrl: updatedUser.photoUrl,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error updating profile' });
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser,
  updateUserProfile,
};