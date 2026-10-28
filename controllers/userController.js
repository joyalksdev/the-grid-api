// backend/controllers/userController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { getIO } = require('../socket');

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

    const generatedUserId = userId || `usr_${username.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Math.floor(1000 + Math.random() * 9000)}`;

    const user = await User.create({
      userId: generatedUserId,
      name,
      email: email ? email.toLowerCase() : undefined,
      username: username.toLowerCase(),
      password,
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

    let wasActive = user.isActive;
    if (typeof req.body.isActive === 'boolean') {
      user.isActive = req.body.isActive;
    }

    if (req.body.password && req.body.password.trim() !== '') {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    // If admin changed active to false, force real-time kick-out
    if (wasActive && !updatedUser.isActive) {
      try {
        getIO().to(`user_${updatedUser._id}`).emit('account_deactivated', {
          message: 'Your account has been deactivated by an administrator.',
        });
      } catch (err) {
        console.error('Socket emit error:', err);
      }
    }

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

    // If toggled to inactive, trigger immediate real-time kick-out socket event
    if (!user.isActive) {
      try {
        getIO().to(`user_${user._id}`).emit('account_deactivated', {
          message: 'Your account status has been changed to inactive by an admin.',
        });
      } catch (err) {
        console.error('Socket emit error:', err);
      }
    }

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

    // Notify user before deleting account
    try {
      getIO().to(`user_${user._id}`).emit('account_deactivated', {
        message: 'Your account has been deleted by an administrator.',
      });
    } catch (err) {
      console.error('Socket emit error:', err);
    }

    await user.deleteOne();
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete user' });
  }
};

// @desc    Update current logged-in user profile info & avatar photo
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

    // Username sanitization and uniqueness check
    if (req.body.username) {
      const sanitizedUsername = req.body.username.toLowerCase().replace(/\s+/g, '');
      
      if (sanitizedUsername !== user.username) {
        const usernameExists = await User.findOne({ username: sanitizedUsername });
        if (usernameExists) {
          return res.status(400).json({ message: 'Username is already taken by another user' });
        }
        user.username = sanitizedUsername;
      }
    }

    if (req.file && req.file.path) {
      user.photoUrl = req.file.path;
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      userId: updatedUser.userId,
      name: updatedUser.name,
      username: updatedUser.username,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      photoUrl: updatedUser.photoUrl,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: error.message || 'Server error updating profile' });
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