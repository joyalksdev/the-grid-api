// backend/controllers/screenController.js
const Screen = require('../models/Screen');
const ActivityLog = require('../models/ActivityLog');
const { calculateSessionCost, getPlayersCount } = require('../config/pricing');
const { getIO } = require('../socket');

/**
 * Helper to generate the next sequential logId
 */
const getNextLogId = async () => {
  const lastLog = await ActivityLog.findOne().sort({ _id: -1 }).select('logId').lean();

  if (!lastLog || !lastLog.logId) {
    return 'LOG-1001';
  }

  const currentNum = parseInt(lastLog.logId.replace('LOG-', ''), 10);
  if (isNaN(currentNum)) {
    return 'LOG-1001';
  }

  return `LOG-${currentNum + 1}`;
};

/**
 * @desc    Get all screens with current status
 * @route   GET /api/screens
 */
const getScreens = async (req, res, next) => {
  try {
    const screens = await Screen.find({}).sort({ screenId: 1 });
    res.json(screens);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Start a new session on a screen
 * @route   POST /api/screens/:id/start
 */
const startSession = async (req, res, next) => {
  try {
    const screenId = parseInt(req.params.id, 10);

    if (isNaN(screenId)) {
      return res.status(400).json({ error: 'Invalid screen ID' });
    }

    const screen = await Screen.findOne({ screenId });

    if (!screen) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    if (screen.status === 'occupied') {
      return res.status(400).json({ error: 'Screen is already occupied' });
    }

    const { player, mode, playersCount, duration, cost } = req.body;

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    screen.status = 'occupied';
    screen.activeSession = {
      player: (player || '').trim() || 'Guest',
      mode,
      playersCount: playersCount || getPlayersCount(mode),
      duration,
      estimatedCost: cost || calculateSessionCost(mode, duration, false),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString()
    };

    await screen.save();

    // Broadcast updated screen state to all clients in real time
    getIO().emit('screen_updated', screen);

    res.json({
      message: 'Session started successfully',
      screen
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Extend an existing session
 * @route   POST /api/screens/:id/extend
 */
const extendSession = async (req, res, next) => {
  try {
    const screenId = parseInt(req.params.id, 10);
    const additionalMinutes = parseInt(req.body.additionalMinutes, 10) || 30;

    if (isNaN(screenId)) {
      return res.status(400).json({ error: 'Invalid screen ID' });
    }

    const screen = await Screen.findOne({ screenId });

    if (!screen) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    if (screen.status !== 'occupied' || !screen.activeSession) {
      return res.status(400).json({ error: 'No active session to extend' });
    }

    const { mode } = screen.activeSession;
    const extensionCost = calculateSessionCost(mode, additionalMinutes, true);

    const currentEnd = new Date(screen.activeSession.endTime);
    const extendedEnd = new Date(currentEnd.getTime() + additionalMinutes * 60 * 1000);

    screen.activeSession.duration += additionalMinutes;
    screen.activeSession.endTime = extendedEnd.toISOString();
    screen.activeSession.estimatedCost = (screen.activeSession.estimatedCost || 0) + extensionCost;

    await screen.save();

    // Broadcast extension update to all clients in real time
    getIO().emit('screen_updated', screen);

    res.json({
      message: 'Session extended successfully',
      screen
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Checkout a session and log the transaction
 * @route   POST /api/screens/:id/checkout
 */
const checkoutSession = async (req, res, next) => {
  try {
    const screenId = parseInt(req.params.id, 10);

    if (isNaN(screenId)) {
      return res.status(400).json({ error: 'Invalid screen ID' });
    }

    const screen = await Screen.findOne({ screenId });

    if (!screen) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    if (screen.status !== 'occupied' || !screen.activeSession) {
      return res.status(400).json({ error: 'No active session to checkout' });
    }

    const activeSessionData = screen.activeSession.toObject
      ? screen.activeSession.toObject()
      : { ...screen.activeSession };

    const { finalCost, paymentType } = req.body;

    let normalizedPayment = 'Cash';
    if (paymentType && paymentType.toLowerCase().includes('upi')) {
      normalizedPayment = 'UPI';
    }

    const logId = await getNextLogId();

    const timeString = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    const finalAmount = finalCost !== undefined ? finalCost : activeSessionData.estimatedCost;

    const logEntry = new ActivityLog({
      logId,
      player: activeSessionData.player,
      screen: `${screen.name} (${activeSessionData.mode})`,
      duration: `${activeSessionData.duration} Mins`,
      cost: finalAmount,
      payment: normalizedPayment,
      timestamp: new Date()
    });

    await logEntry.save();

    // Reset screen status
    screen.status = 'available';
    screen.activeSession = null;
    await screen.save();

    const formattedLog = {
      id: logId,
      player: activeSessionData.player,
      screen: `${screen.name} (${activeSessionData.mode})`,
      duration: `${activeSessionData.duration} Mins`,
      cost: finalAmount,
      payment: normalizedPayment,
      time: timeString
    };

    // Broadcast screen clearance AND new activity log entry in real time
    getIO().emit('screen_updated', screen);
    getIO().emit('log_added', formattedLog);

    res.json({
      message: 'Checkout completed successfully',
      screen,
      logEntry: formattedLog
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getScreens,
  startSession,
  extendSession,
  checkoutSession
};