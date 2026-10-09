const ActivityLog = require('../models/ActivityLog');

/**
 * Helper to escape special regex characters safely
 */
const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

/**
 * Helper to generate the next sequential logId
 */
const getNextLogId = async () => {
  const lastLog = await ActivityLog.findOne()
    .sort({ createdAt: -1, _id: -1 })
    .select('logId')
    .lean();

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
 * @desc    Create a new activity log entry
 * @route   POST /api/logs
 * @access  Private (Staff / Operator / Admin / Owner)
 */
const createLog = async (req, res) => {
  try {
    const { player, screen, duration, cost, payment, startTime, endTime, timestamp } = req.body;

    if (!player || !screen || !duration || cost === undefined || !payment) {
      return res.status(400).json({ error: 'Please provide all required log fields' });
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
      loggedBy: staffUser ? staffUser._id : null,
      operatorName,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      timestamp: timestamp ? new Date(timestamp) : new Date()
    });

    res.status(201).json({
      _id: newLog._id,
      id: newLog.logId,
      player: newLog.player,
      screen: newLog.screen,
      duration: newLog.duration,
      cost: newLog.cost,
      payment: newLog.payment,
      loggedBy: newLog.loggedBy,
      operatorName: newLog.operatorName,
      startTime: newLog.startTime,
      endTime: newLog.endTime,
      time: newLog.timestamp
        ? new Date(newLog.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A',
      timestamp: newLog.timestamp,
      createdAt: newLog.createdAt
    });
  } catch (error) {
    console.error('Error creating log:', error);
    res.status(500).json({ error: 'Failed to create activity log entry' });
  }
};

/**
 * @desc    Get activity logs with search, date range/custom date, payment & screen filters
 * @route   GET /api/logs
 */
const getLogs = async (req, res) => {
  try {
    const { search, dateRange, date, payment, screen } = req.query;
    let query = {};
    const now = new Date();

    const range = dateRange || date;

    // Date Range Processing
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

    // Payment Filter
    if (payment && payment !== 'all') {
      if (payment.toLowerCase() === 'upi') {
        query.payment = { $regex: /upi|gpay/i };
      } else {
        query.payment = payment;
      }
    }

    // Screen Filter
    if (screen && screen !== 'all') {
      query.screen = screen;
    }

    // Search Filter
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

    const logs = await ActivityLog.find(query)
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
      loggedBy: log.loggedBy,
      operatorName: log.operatorName || 'System Staff',
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

/**
 * @desc    Get aggregated metrics
 * @route   GET /api/logs/metrics
 */
const getMetrics = async (req, res) => {
  try {
    const metrics = await ActivityLog.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$cost' },
          totalSessions: { $sum: 1 },
          totalCash: {
            $sum: {$cond: [{ $eq: [{$toLower: '$payment' }, 'cash'] }, '$cost', 0]
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
                0
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

/**
 * @desc    Get logs for a specific player
 * @route   GET /api/logs/player/:playerName
 */
const getLogsByPlayer = async (req, res) => {
  try {
    const { playerName } = req.params;
    const safePlayer = escapeRegex(playerName);

    const logs = await ActivityLog.find({
      player: { $regex: new RegExp(`^${safePlayer}$`, 'i') }
    })
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
      loggedBy: log.loggedBy,
      operatorName: log.operatorName || 'System Staff',
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

/**
 * @desc    Update an activity log entry with strict ownership check
 * @route   PUT /api/logs/:id
 * @access  Private
 */
const updateLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { player, screen, duration, cost, payment } = req.body;

    const log = await ActivityLog.findById(id);

    if (!log) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    // STRICT OWNERSHIP CHECK:
    // Owner and Admin can edit any log.
    // Staff/Operator can ONLY edit logs that they logged themselves.
    const isElevatedRole = req.user && ['owner', 'admin'].includes(req.user.role);
    const isCreator = log.loggedBy && req.user && log.loggedBy.toString() === req.user._id.toString();

    if (!isElevatedRole && !isCreator) {
      return res.status(403).json({
        error: 'Permission denied. Staff members can only edit logs created by themselves.'
      });
    }

    if (player !== undefined) log.player = player;
    if (screen !== undefined) log.screen = screen;
    if (duration !== undefined) log.duration = String(duration);
    if (cost !== undefined) log.cost = Number(cost);
    if (payment !== undefined) log.payment = payment;

    const updatedLog = await log.save();

    res.json({
      _id: updatedLog._id,
      id: updatedLog.logId,
      player: updatedLog.player,
      screen: updatedLog.screen,
      duration: updatedLog.duration,
      cost: updatedLog.cost,
      payment: updatedLog.payment,
      loggedBy: updatedLog.loggedBy,
      operatorName: updatedLog.operatorName,
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

/**
 * @desc    Delete an activity log entry with strict ownership check
 * @route   DELETE /api/logs/:id
 * @access  Private
 */
const deleteLog = async (req, res) => {
  try {
    const { id } = req.params;

    const log = await ActivityLog.findById(id);

    if (!log) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    // STRICT OWNERSHIP CHECK:
    // Owner and Admin can delete any log.
    // Staff/Operator can ONLY delete logs that they logged themselves.
    const isElevatedRole = req.user && ['owner', 'admin'].includes(req.user.role);
    const isCreator = log.loggedBy && req.user && log.loggedBy.toString() === req.user._id.toString();

    if (!isElevatedRole && !isCreator) {
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