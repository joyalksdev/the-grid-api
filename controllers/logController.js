// controllers/logController.js
const ActivityLog = require('../models/ActivityLog');

const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

const getNextLogId = async () => {
  const lastLog = await ActivityLog.findOne()
    .sort({ createdAt: -1, _id: -1 })
    .select('logId')
    .lean();

  if (!lastLog || !lastLog.logId) {
    return 'LOG-001';
  }

  const currentNum = parseInt(lastLog.logId.replace('LOG-', ''), 10);
  if (isNaN(currentNum)) {
    return 'LOG-001';
  }

  return `LOG-${String(currentNum + 1).padStart(3, '0')}`;
};

const createLog = async (req, res) => {
  try {
    const { player, screen, duration, cost, payment, splitDetails, startTime, endTime, timestamp } = req.body;

    if (!player || !screen || !duration || cost === undefined || !payment) {
      return res.status(400).json({ error: 'Please provide all required log fields' });
    }

    if (payment === 'Split') {
      const cash = Number(splitDetails?.cashAmount || 0);
      const upi = Number(splitDetails?.upiAmount || 0);
      if (cash + upi !== Number(cost)) {
        return res.status(400).json({ error: 'Split payment amounts must equal the total cost' });
      }
    }

    const logId = await getNextLogId();
    const staffUser = req.user;
    const operatorName = staffUser ? (staffUser.name || staffUser.username) : 'System Staff';

    const newLog = await ActivityLog.create({
      logId,
      player,
      screen,
      duration: String(duration),
      cost: Number(cost),
      payment,
      splitDetails: payment === 'Split' ? {
        cashAmount: Number(splitDetails.cashAmount || 0),
        upiAmount: Number(splitDetails.upiAmount || 0)
      } : { cashAmount: 0, upiAmount: 0 },
      loggedBy: staffUser ? staffUser._id : null,
      operatorName,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      timestamp: timestamp ? new Date(timestamp) : new Date()
    });

    // Populate the newly created log's loggedBy field for immediate client render sync
    const populatedLog = await ActivityLog.findById(newLog._id)
      .populate('loggedBy', 'name username email photoUrl role')
      .lean();

    res.status(201).json({
      _id: populatedLog._id,
      id: populatedLog.logId,
      player: populatedLog.player,
      screen: populatedLog.screen,
      duration: populatedLog.duration,
      cost: populatedLog.cost,
      payment: populatedLog.payment,
      splitDetails: populatedLog.splitDetails,
      loggedBy: populatedLog.loggedBy,
      operatorName: populatedLog.operatorName,
      startTime: populatedLog.startTime,
      endTime: populatedLog.endTime,
      time: populatedLog.timestamp
        ? new Date(populatedLog.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A',
      timestamp: populatedLog.timestamp,
      createdAt: populatedLog.createdAt
    });
  } catch (error) {
    console.error('Error creating log:', error);
    res.status(500).json({ error: 'Failed to create activity log entry' });
  }
};

const getLogs = async (req, res) => {
  try {
    const { search, dateRange, date, payment, screen } = req.query;
    let query = {};
    const now = new Date();
    const range = dateRange || date;

    if (range && range !== 'all') {
      let start, end;

      if (range === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      } else if (range === 'yesterday') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      } else if (range === 'this_week') {
        const firstDay = now.getDate() - now.getDay();
        start = new Date(now.getFullYear(), now.getMonth(), firstDay, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      } else if (range === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else {
        const baseDate = new Date(range);
        if (!isNaN(baseDate.getTime())) {
          start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
          end = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
        }
      }

      if (start && end) {
        query.timestamp = { $gte: start,$lte: end };
      }
    } else if (!range) {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      query.timestamp = { $gte: startOfDay,$lte: endOfDay };
    }

    if (payment && payment !== 'all') {
      if (payment.toLowerCase() === 'upi') {
        query.payment = { $regex: /upi|gpay/i };
      } else {
        query.payment = payment;
      }
    }

    if (screen && screen !== 'all') {
      const safeScreen = escapeRegex(screen);
      query.screen = { $regex: new RegExp(safeScreen, 'i') };
    }

    if (search && search.trim()) {
      const safeSearch = escapeRegex(search.trim());
      const searchRegex = { $regex: safeSearch,$options: 'i' };
      query.$or = [
        { player: searchRegex },
        { logId: searchRegex },
        { screen: searchRegex },
        { operatorName: searchRegex }
      ];
    }

    // Populate user profile info (including photoUrl) for the staff member who logged the session
    const logs = await ActivityLog.find(query)
      .populate('loggedBy', 'name username email photoUrl role')
      .sort({ timestamp: -1, createdAt: -1 })
      .select('-__v')
      .lean();

    const formattedLogs = logs.map((log) => ({
      _id: log._id,
      id: log.logId || `LOG-${log._id.toString().slice(-4)}`,
      player: log.player,
      screen: log.screen,
      duration: log.duration,
      cost: log.cost,
      payment: log.payment,
      splitDetails: log.splitDetails || { cashAmount: 0, upiAmount: 0 },
      loggedBy: log.loggedBy, // Now contains populated user object with photoUrl
      operatorName: log.operatorName || log.loggedBy?.name || 'System Staff',
      startTime: log.startTime,
      endTime: log.endTime,
      time: log.timestamp
        ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A',
      timestamp: log.timestamp,
      createdAt: log.createdAt || log.timestamp
    }));

    res.json(formattedLogs);
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};

const getMetrics = async (req, res) => {
  try {
    const metrics = await ActivityLog.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$cost' },
          totalSessions: { $sum: 1 },
          totalCash: {
            $sum: {$cond: [
                { $eq: [{ $toLower: '$payment' }, 'cash'] },
                '$cost',
                {
                  $cond: [
                    { $eq: [{ $toLower: '$payment' }, 'split'] },
                    { $ifNull: ['$splitDetails.cashAmount', 0] },
                    0
                  ]
                }
              ]
            }
          },
          totalUPI: {
            $sum: {$cond: [
                {
                  $or: [
                    { $regexMatch: { input: '$payment', regex: /upi/i } },
                    { $regexMatch: { input: '$payment', regex: /gpay/i } }
                  ]
                },
                '$cost',
                {
                  $cond: [
                    { $eq: [{ $toLower: '$payment' }, 'split'] },
                    { $ifNull: ['$splitDetails.upiAmount', 0] },
                    0
                  ]
                }
              ]
            }
          }
        }
      }
    ]);

    const result = metrics.length > 0 ? metrics[0] : { totalRevenue: 0, totalCash: 0, totalUPI: 0, totalSessions: 0 };

    res.json({
      totalRevenue: result.totalRevenue || 0,
      totalCash: result.totalCash || 0,
      totalUPI: result.totalUPI || 0,
      totalSessions: result.totalSessions || 0
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
};

const getLogsByPlayer = async (req, res) => {
  try {
    const { playerName } = req.params;
    const safePlayer = escapeRegex(playerName);

    const logs = await ActivityLog.find({
      player: { $regex: new RegExp(`^${safePlayer}$`, 'i') }
    })
      .populate('loggedBy', 'name username email photoUrl role')
      .sort({ timestamp: -1, createdAt: -1 })
      .select('-__v')
      .lean();

    const formattedLogs = logs.map((log) => ({
      _id: log._id,
      id: log.logId || `LOG-${log._id.toString().slice(-4)}`,
      player: log.player,
      screen: log.screen,
      duration: log.duration,
      cost: log.cost,
      payment: log.payment,
      splitDetails: log.splitDetails || { cashAmount: 0, upiAmount: 0 },
      loggedBy: log.loggedBy,
      operatorName: log.operatorName || log.loggedBy?.name || 'System Staff',
      startTime: log.startTime,
      endTime: log.endTime,
      time: log.timestamp
        ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A',
      timestamp: log.timestamp,
      createdAt: log.createdAt || log.timestamp
    }));

    res.json(formattedLogs);
  } catch (error) {
    console.error('Error fetching player logs:', error);
    res.status(500).json({ error: 'Failed to fetch player logs' });
  }
};

const updateLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { player, screen, duration, cost, payment, splitDetails } = req.body;

    const log = await ActivityLog.findById(id);
    if (!log) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    const userRole = req.user?.role?.toLowerCase();
    const isElevated = ['owner', 'admin'].includes(userRole);
    const isCreator = log.loggedBy && req.user?._id && log.loggedBy.toString() === req.user._id.toString();

    if (!isElevated && !isCreator) {
      return res.status(403).json({
        error: 'Permission denied. Staff members can only edit logs created by themselves.'
      });
    }

    if (player !== undefined) log.player = player;
    if (screen !== undefined) log.screen = screen;
    if (duration !== undefined) log.duration = String(duration);
    if (cost !== undefined) log.cost = Number(cost);
    if (payment !== undefined) log.payment = payment;
    if (payment === 'Split' && splitDetails) {
      log.splitDetails = {
        cashAmount: Number(splitDetails.cashAmount || 0),
        upiAmount: Number(splitDetails.upiAmount || 0)
      };
    } else if (payment && payment !== 'Split') {
      log.splitDetails = { cashAmount: 0, upiAmount: 0 };
    }

    await log.save();

    const updatedLog = await ActivityLog.findById(log._id)
      .populate('loggedBy', 'name username email photoUrl role')
      .lean();

    res.json({
      _id: updatedLog._id,
      id: updatedLog.logId,
      player: updatedLog.player,
      screen: updatedLog.screen,
      duration: updatedLog.duration,
      cost: updatedLog.cost,
      payment: updatedLog.payment,
      splitDetails: updatedLog.splitDetails,
      loggedBy: updatedLog.loggedBy,
      operatorName: updatedLog.operatorName || updatedLog.loggedBy?.name || 'System Staff',
      startTime: updatedLog.startTime,
      endTime: updatedLog.endTime,
      time: updatedLog.timestamp
        ? new Date(updatedLog.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A',
      timestamp: updatedLog.timestamp
    });
  } catch (error) {
    console.error('Error updating log:', error);
    res.status(500).json({ error: 'Failed to update log entry' });
  }
};

const deleteLog = async (req, res) => {
  try {
    const { id } = req.params;

    const log = await ActivityLog.findById(id);
    if (!log) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    const userRole = req.user?.role?.toLowerCase();
    const isElevated = ['owner', 'admin'].includes(userRole);
    const isCreator = log.loggedBy && req.user?._id && log.loggedBy.toString() === req.user._id.toString();

    if (!isElevated && !isCreator) {
      return res.status(403).json({
        error: 'Permission denied. Staff members can only delete logs created by themselves.'
      });
    }

    await log.deleteOne();

    res.json({ message: 'Log entry removed successfully' });
  } catch (error) {
    console.error('Error deleting log:', error);
    res.status(500).json({ error: 'Failed to delete log entry' });
  }
};

module.exports = {
  createLog,
  getLogs,
  getMetrics,
  getLogsByPlayer,
  updateLog,
  deleteLog
};