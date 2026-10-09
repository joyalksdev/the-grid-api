const crypto = require('crypto');
const User = require('../models/User');
const Invite = require('../models/Invite');
const jwt = require('jsonwebtoken');

const isProduction = process.env.NODE_ENV === 'production';

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET || 'fallback_secret_key', {
    expiresIn: '7d',
  });
};

/**
 * @desc    Login user with userId, username or Email
 * @route   POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please provide User ID/Email and password' });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    const user = await User.findOne({
      $or: [
        { userId: cleanIdentifier },
        { username: cleanIdentifier },
        { email: cleanIdentifier },
      ],
    }).select('+password');

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'inactive' || !user.isActive) {
      return res.status(403).json({ error: 'Account is awaiting admin approval or deactivated.' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user._id, user.role);

    res.cookie('token', token, cookieOptions);

    res.json({
      token,
      user: {
        id: user._id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Server error during authentication' });
  }
};

/**
 * @desc    Register a new operator/admin directly
 * @route   POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { userId, name, email, phone, password, role } = req.body;

    const cleanEmail = email && email.trim() !== '' ? email.trim().toLowerCase() : undefined;
    const cleanPhone = phone && phone.trim() !== '' ? phone.trim() : undefined;
    const cleanUserId = userId ? userId.trim() : undefined;

    const existingUser = await User.findOne({
      $or: [
        ...(cleanUserId ? [{ userId: cleanUserId }] : []),
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
        ...(cleanPhone ? [{ phone: cleanPhone }] : []),
      ],
    });

    if (existingUser) {
      if (cleanPhone && existingUser.phone === cleanPhone) {
        return res.status(400).json({ error: 'An account with this phone number already exists' });
      }
      if (cleanEmail && existingUser.email === cleanEmail) {
        return res.status(400).json({ error: 'An account with this email address already exists' });
      }
      return res.status(400).json({ error: 'User ID already registered' });
    }

    const user = await User.create({
      userId: cleanUserId,
      name,
      email: cleanEmail,
      phone: cleanPhone,
      password,
      role: role || 'staff',
      status: 'inactive',
      isActive: false,
    });

    res.status(201).json({
      message: 'Account created successfully. Awaiting admin approval.',
      user: {
        id: user._id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Registration Error:', error);

    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({
        error: `An account with this ${duplicateField} already exists.`,
      });
    }

    res.status(500).json({ error: 'Failed to create user account' });
  }
};

/**
 * @desc    Logout user / clear cookie
 * @route   POST /api/auth/logout
 */
const logout = (req, res) => {
  res.cookie('token', '', {
    ...cookieOptions,
    expires: new Date(0),
  });
  res.json({ message: 'Logged out successfully' });
};

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 */
const getMe = async (req, res) => {
  res.json({ user: req.user });
};

/**
 * @desc    Generate Single-Use Invite Token
 * @route   POST /api/auth/invite
 * @access  Private/Admin
 */
const inviteUser = async (req, res) => {
  try {
    const { role, expiresInHours } = req.body;
    const hours = Number(expiresInHours) || 24;

    // Generate raw random crypto token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const displayToken = `GRID-INV-${rawToken.substring(0, 6).toUpperCase()}`;

    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const newInvite = await Invite.create({
      token: hashedToken,
      displayToken,
      role: role || 'staff',
      expiresAt,
      createdBy: req.user?._id,
    });

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const inviteUrl = `${clientUrl}/onboard?token=${rawToken}&role=${newInvite.role}`;

    res.status(201).json({
      success: true,
      message: 'Invitation link generated successfully',
      token: rawToken,
      inviteUrl,
      invite: {
        _id: newInvite._id,
        token: displayToken,
        role: newInvite.role,
        expiresAt: newInvite.expiresAt,
        status: 'active',
      },
    });
  } catch (error) {
    console.error('Invite generation error:', error);
    res.status(500).json({ message: error.message || 'Failed to generate invitation' });
  }
};

/**
 * @desc    Get Active Invites List
 * @route   GET /api/auth/invites
 * @access  Private/Admin
 */
const getInvites = async (req, res) => {
  try {
    const invites = await Invite.find({
      isUsed: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    const formattedInvites = invites.map((inv) => ({
      _id: inv._id,
      token: inv.displayToken,
      role: inv.role,
      expiresAt: inv.expiresAt,
      status: 'active',
    }));

    res.status(200).json(formattedInvites);
  } catch (error) {
    console.error('Error fetching invites:', error);
    res.status(500).json({ message: 'Failed to fetch invite tokens' });
  }
};

/**
 * @desc    Revoke/Delete Invite Token
 * @route   DELETE /api/auth/invites/:id
 * @access  Private/Admin
 */
const revokeInvite = async (req, res) => {
  try {
    await Invite.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Invite token revoked successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to revoke invite token' });
  }
};

/**
 * @desc    Verify Onboarding Token
 * @route   GET /api/auth/verify-invite/:token
 * @access  Public
 */
const verifyInviteToken = async (req, res) => {
  try {
    const rawToken = req.params.token;
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invite = await Invite.findOne({
      token: hashedToken,
      isUsed: false,
      expiresAt: { $gt: Date.now() },
    });

    if (!invite) {
      return res.status(400).json({ valid: false, message: 'Invite link is invalid or has expired' });
    }

    res.status(200).json({
      valid: true,
      user: {
        role: invite.role,
      },
    });
  } catch (error) {
    res.status(500).json({ valid: false, message: 'Server error verifying token' });
  }
};

/**
 * @desc    Complete Onboarding Form, Create User & Burn Token
 * @route   POST /api/auth/complete-onboarding
 * @access  Public
 */
const completeOnboarding = async (req, res) => {
  try {
    const { token, name, email, username, password, phone } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const invite = await Invite.findOne({
      token: hashedToken,
      isUsed: false,
      expiresAt: { $gt: Date.now() },
    });

    if (!invite) {
      return res.status(400).json({ message: 'Invitation token is invalid or has expired' });
    }

    const cleanName = name?.trim() || 'New Operator';
    const cleanUsername = username ? username.trim().toLowerCase() : `usr_${Date.now().toString().slice(-6)}`;
    const cleanEmail = email && email.trim() !== '' ? email.trim().toLowerCase() : undefined;
    const cleanPhone = phone && phone.trim() !== '' ? phone.trim() : undefined;

    const generatedUserId = `usr_${cleanUsername.replace(/[^a-z0-9]/g, '')}_${Math.floor(1000 + Math.random() * 9000)}`;

    // Explicit Duplicate Verification Check
    const existing = await User.findOne({
      $or: [
        ...(cleanUsername ? [{ username: cleanUsername }] : []),
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
        ...(cleanPhone ? [{ phone: cleanPhone }] : []),
      ],
    });

    if (existing) {
      if (cleanPhone && existing.phone === cleanPhone) {
        return res.status(400).json({ message: 'An account with this phone number already exists.' });
      }
      if (cleanEmail && existing.email === cleanEmail) {
        return res.status(400).json({ message: 'An account with this email address already exists.' });
      }
      if (cleanUsername && existing.username === cleanUsername) {
        return res.status(400).json({ message: 'An account with this username already exists.' });
      }
      return res.status(400).json({ message: 'User details already exist in the system.' });
    }

    // Create new inactive user
    const newUser = await User.create({
      userId: generatedUserId,
      name: cleanName,
      username: cleanUsername,
      email: cleanEmail,
      phone: cleanPhone,
      password,
      photoUrl: req.file && req.file.path ? req.file.path : null,
      role: invite.role || 'staff',
      status: 'inactive',
      isActive: false,
    });

    // Mark invite as used / consumed
    invite.isUsed = true;
    await invite.save();

    // Emit Socket.io Event to Admins that a new user completed onboarding
    try {
      const { getIO } = require('../socket');
      getIO().emit('user:onboarded', {
        _id: newUser._id,
        name: newUser.name,
        username: newUser.username,
        role: newUser.role,
        phone: newUser.phone,
      });
    } catch (e) {
      // Socket not initialized scenario
    }

    res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully. Account is now awaiting admin approval.',
      status: 'inactive',
    });
  } catch (error) {
    console.error('Onboarding complete error:', error);

    // MongoDB Duplicate Key Error Guard (E11000)
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({
        message: `An account with this ${duplicateField} already exists. Please check your details or contact an admin.`,
      });
    }

    res.status(500).json({ message: error.message || 'Error completing onboarding' });
  }
};

module.exports = {
  login,
  register,
  logout,
  getMe,
  inviteUser,
  getInvites,
  revokeInvite,
  verifyInviteToken,
  completeOnboarding,
};