// backend/controllers/logController.js
const ActivityLog = require('../models/ActivityLog');


/**
 * Helper to generate the next sequential logId
 */
const getNextLogId = async () => {
  // Find the last created activity log
  const lastLog = await ActivityLog.findOne().sort({ _id: -1 }).select('logId').lean();

  if (!lastLog || !lastLog.logId) {
    return 'LOG-1001';
  }

  // Extract digits from "LOG-XXXX"
  const currentNum = parseInt(lastLog.logId.replace('LOG-', ''), 10);
  
  if (isNaN(currentNum)) {
    return 'LOG-1001';
  }

  return `LOG-${currentNum + 1}`;
};


/**
 * @desc    Get all activity logs with optional search filter
 * @route   GET /api/logs
 */
const getLogs = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      query = {
        $or: [
          { player: { $regex: search, $options: 'i' } },
          { logId: { $regex: search, $options: 'i' } },
          { screen: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const logs = await ActivityLog.find(query)
      .sort({ timestamp: -1, createdAt: -1 })
      .select('-__v');

    const formattedLogs = logs.map((log) => ({
      _id: log._id,
      id: log.logId || `LOG-${log._id.toString().slice(-4)}`,
      player: log.player,
      screen: log.screen,
      duration: log.duration,
      cost: log.cost,
      payment: log.payment,
      time: log.timestamp
        ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A',
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
    const logs = await ActivityLog.find({
      player: { $regex: new RegExp(`^${playerName}$`, 'i') }
    })
      .sort({ timestamp: -1, createdAt: -1 })
      .select('-__v');

    const formattedLogs = logs.map((log) => ({
      _id: log._id,
      id: log.logId || `LOG-${log._id.toString().slice(-4)}`,
      player: log.player,
      screen: log.screen,
      duration: log.duration,
      cost: log.cost,
      payment: log.payment,
      time: log.timestamp
        ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A',
      createdAt: log.createdAt || log.timestamp
    }));

    res.json(formattedLogs);
  } catch (error) {
    console.error('Error fetching player logs:', error);
    res.status(500).json({ error: 'Failed to fetch player logs' });
  }
};

module.exports = {
  getLogs,
  getMetrics,
  getLogsByPlayer
};