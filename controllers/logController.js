const ActivityLog = require('../models/ActivityLog');

/**
 * Helper to escape special regex characters safely
 */
const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

/**
 * Helper to generate the next sequential logId
 */
const getNextLogId = async () => {
  const lastLog = await ActivityLog.findOne().sort({ createdAt: -1, _id: -1 }).select('logId').lean();

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
 */
const createLog = async (req, res) => {
  try {
    const { player, screen, duration, cost, payment, startTime, endTime, timestamp } = req.body;

    if (!player || !screen || !duration || cost === undefined || !payment) {
      return res.status(400).json({ error: 'Please provide all required log fields' });
    }

    const logId = await getNextLogId();

    const newLog = await ActivityLog.create({
      logId,
      player,
      screen,
      duration: String(duration),
      cost: Number(cost),
      payment,
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
 * @desc    Get activity logs with optional search filter and date range
 * @route   GET /api/logs
 */
const getLogs = async (req, res) => {
  try {
    const { search, date } = req.query;
    let query = {};

    // Fixed date boundaries calculation
    if (date && date !== 'all') {
      const baseDate = new Date(date);
      if (!isNaN(baseDate.getTime())) {
        const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
        query.timestamp = { $gte: startOfDay, $lte: endOfDay };
      }
    } else if (!date) {
      // Default to today
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      query.timestamp = { $gte: startOfDay, $lte: endOfDay };
    }

    if (search && search.trim()) {
      const safeSearch = escapeRegex(search.trim());
      const searchRegex = { $regex: safeSearch, $options: 'i' };
      query.$or = [
        { player: searchRegex },
        { logId: searchRegex },
        { screen: searchRegex }
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
 * @desc    Get aggregated metrics (total revenue and session count)
 * @route   GET /api/logs/metrics
 */
const getMetrics = async (req, res) => {
  try {
    const metrics = await ActivityLog.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$cost' },
          totalSessions: { $sum: 1 }
        }
      }
    ]);

    const result = metrics.length > 0 ? metrics[0] : { totalRevenue: 0, totalSessions: 0 };

    res.json({
      totalRevenue: result.totalRevenue || 0,
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
 * @desc    Update an activity log entry
 * @route   PUT /api/logs/:id
 */
const updateLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { player, screen, duration, cost, payment } = req.body;

    const updatedLog = await ActivityLog.findByIdAndUpdate(
      id,
      { 
        player, 
        screen, 
        duration: String(duration), 
        cost: Number(cost), 
        payment 
      },
      { new: true, runValidators: true }
    );

    if (!updatedLog) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    res.json({
      _id: updatedLog._id,
      id: updatedLog.logId,
      player: updatedLog.player,
      screen: updatedLog.screen,
      duration: updatedLog.duration,
      cost: updatedLog.cost,
      payment: updatedLog.payment,
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
 * @desc    Delete an activity log entry
 * @route   DELETE /api/logs/:id
 */
const deleteLog = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedLog = await ActivityLog.findByIdAndDelete(id);

    if (!deletedLog) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

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