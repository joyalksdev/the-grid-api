const ActivityLog = require('../models/ActivityLog');
const HardwareDevice = require('../models/HardwareDevice');
const ServiceLog = require('../models/ServiceLog');
const Task = require('../models/Task');
const Screen = require('../models/Screen');

/**
 * Safe Mongo expression to extract numeric minutes from duration string (e.g., "75 Mins" -> 75)
 */
const safeDurationExpr = {
  $convert: {
    input: {
      $arrayElemAt: [
        { $split: [{$toString: { $ifNull: ['$duration', '0'] } }, ' '] },
        0
      ]
    },
    to: 'double',
    onError: 0,
    onNull: 0
  }
};

/**
 * Helper to generate start & end Date objects based on timeframe param
 */
const getDateRange = (range, customStart, customEnd) => {
  const now = new Date();
  let start = null;
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (range === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  } else if (range === '7d') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
  } else if (range === '30d') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0);
  } else if (range === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  } else if (range === '3m') {
    start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate(), 0, 0, 0, 0);
  } else if (range === 'custom' && customStart) {
    start = new Date(customStart);
    if (customEnd) end = new Date(customEnd);
  }

  return { start, end };
};

/**
 * @desc    Get aggregated business analytics, live hardware stats, and task completion metrics
 * @route   GET /api/analytics
 * @access  Private (Owner / Admin)
 */
const getDashboardAnalytics = async (req, res, next) => {
  try {
    const { range = '30d', startDate, endDate } = req.query;
    const { start, end } = getDateRange(range, startDate, endDate);

    // Build base date filter query matching timestamp or createdAt
    const logMatchQuery = {};
    if (start && end) {
      logMatchQuery.$or = [
        { timestamp: { $gte: start,$lte: end } },
        { createdAt: { $gte: start,$lte: end } }
      ];
    }

    // 1. REVENUE, CASH/UPI SPLIT & SESSION METRICS AGGREGATION
    const revenueMetrics = await ActivityLog.aggregate([
      { $match: logMatchQuery },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$cost' },
          totalSessions: { $sum: 1 },
          totalDurationMins: { $sum: safeDurationExpr },
          cashRevenue: {
            $sum: {$cond: [{ $eq: [{$toLower: '$payment' }, 'cash'] }, '$cost', 0]
            }
          },
          upiRevenue: {
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

    const revStats = revenueMetrics[0] || {
      totalRevenue: 0,
      totalSessions: 0,
      totalDurationMins: 0,
      cashRevenue: 0,
      upiRevenue: 0
    };

    const avgRevenuePerSession = revStats.totalSessions
      ? Math.round(revStats.totalRevenue / revStats.totalSessions)
      : 0;
    const avgDurationMins = revStats.totalSessions
      ? Math.round(revStats.totalDurationMins / revStats.totalSessions)
      : 0;

    // 2. DAILY REVENUE TREND FOR CHARTS
    const dailyTrend = await ActivityLog.aggregate([
      { $match: logMatchQuery },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $ifNull: ['$timestamp', '$createdAt'] }
            }
          },
          revenue: { $sum: '$cost' },
          sessions: { $sum: 1 }         }       },       {$sort: { _id: 1 } }
    ]);

    const chartData = dailyTrend
      .filter((item) => item._id !== null)
      .map((item) => {
        const d = new Date(item._id);
        const label = isNaN(d.getTime())
          ? item._id
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return {
          date: item._id,
          label,
          revenue: item.revenue,
          sessions: item.sessions
        };
      });

    // 3. BUSIEST PEAK HOURS ANALYSIS
    const hourlyDistribution = await ActivityLog.aggregate([
      { $match: logMatchQuery },
      {
        $group: {
          _id: {
            $hour: {$ifNull: ['$timestamp', '$createdAt'] }
          },
          count: { $sum: 1 }         }       },       {$sort: { count: -1 } }
    ]);

    const peakHourIndex = hourlyDistribution.length > 0 ? hourlyDistribution[0]._id : 18;
    const peakHourFormatted = `${peakHourIndex % 12 || 12} ${peakHourIndex >= 12 ? 'PM' : 'AM'}`;

    // 4. STATION OCCUPANCY & REVENUE BREAKDOWN
    const stationBreakdown = await ActivityLog.aggregate([
      { $match: logMatchQuery },
      {
        $group: {
          _id: '$screen',
          value: { $sum: '$cost' },
          sessions: { $sum: 1 },
          totalMinutes: { $sum: safeDurationExpr }
        }
      },
      { $sort: { value: -1 } }
    ]);

    const stationList = stationBreakdown.map((st) => ({
      name: st._id || 'Default Station',
      value: st.value,
      sessions: st.sessions,
      totalMinutes: st.totalMinutes
    }));

    // 5. TOP GAMERS LEADERBOARD
    const topGamers = await ActivityLog.aggregate([
      { $match: logMatchQuery },
      {
        $group: {
          _id: { $trim: { input: '$player' } },
          spent: { $sum: '$cost' },
          sessions: { $sum: 1 },
          totalMins: { $sum: safeDurationExpr }
        }
      },
      { $sort: { spent: -1 } },       {$limit: 5 }
    ]);

    const topPlayers = topGamers.map((p) => ({
      name: p._id || 'Anonymous Player',
      spent: p.spent,
      sessions: p.sessions,
      totalMins: p.totalMins
    }));

    // 6. STAFF SALES & TRANSACTION PERFORMANCE
    const staffPerformance = await ActivityLog.aggregate([
      { $match: logMatchQuery },
      {
        $group: {
          _id: { $ifNull: ['$operatorName', 'System Staff'] },
          totalRevenue: { $sum: '$cost' },
          sessionsLogged: { $sum: 1 },
          totalMinutes: { $sum: safeDurationExpr },
          cashCollected: {
            $sum: {$cond: [{ $eq: [{$toLower: '$payment' }, 'cash'] }, '$cost', 0]
            }
          },
          upiCollected: {
            $sum: {$cond: [
                {
                  $or: [
                    { $regexMatch: { input: '$payment', regex: /upi/i } },
                    { $regexMatch: { input: '$payment', regex: /gpay/i } }
                  ]
                },
                '$cost',                 0               ]             }           }         }       },       {$sort: { totalRevenue: -1 } }
    ]);

    const staffAnalytics = staffPerformance.map((staff) => ({
      name: staff._id,
      totalRevenue: staff.totalRevenue,
      sessionsLogged: staff.sessionsLogged,
      totalMinutes: staff.totalMinutes,
      avgPerSession: staff.sessionsLogged ? Math.round(staff.totalRevenue / staff.sessionsLogged) : 0,
      cashCollected: staff.cashCollected,
      upiCollected: staff.upiCollected
    }));

    // 7. HARDWARE & SERVICE EXPENSES METRICS
    const serviceCostAgg = await ServiceLog.aggregate([
      {
        $group: {
          _id: null,
          totalRepairExpenses: { $sum: '$cost' },
          totalIssuesReported: { $sum: 1 }
        }
      }
    ]);

    const activeDeviceCount = await HardwareDevice.countDocuments({ status: 'active' });
    const maintenanceDeviceCount = await HardwareDevice.countDocuments({ status: 'maintenance' });

    const hardwareStats = {
      totalRepairExpenses: serviceCostAgg[0]?.totalRepairExpenses || 0,
      totalIssuesReported: serviceCostAgg[0]?.totalIssuesReported || 0,
      activeDevices: activeDeviceCount,
      maintenanceDevices: maintenanceDeviceCount
    };

    // 8. STAFF TASK COMPLETION PERFORMANCE
    const totalTasks = await Task.countDocuments();
    const completedTasks = await Task.countDocuments({ status: 'completed' });
    const verifiedTasks = await Task.countDocuments({ status: 'verified' });
    const pendingTasks = await Task.countDocuments({ status: 'pending' });

    const taskStats = {
      totalTasks,
      completed: completedTasks + verifiedTasks,
      pending: pendingTasks,
      completionRatePct: totalTasks
        ? Math.round(((completedTasks + verifiedTasks) / totalTasks) * 100)
        : 0
    };

    // 9. LIVE SCREEN STATES
    const screens = await Screen.find({}).sort({ screenId: 1 }).lean();

    // FINAL RESPONSE
    res.json({
      timeframe: range,
      summary: {
        totalRevenue: revStats.totalRevenue,
        cashRevenue: revStats.cashRevenue,
        upiRevenue: revStats.upiRevenue,
        totalSessions: revStats.totalSessions,
        avgRevenuePerSession,
        avgDurationMins,
        peakHourFormatted
      },
      chartData,
      stationList,
      topPlayers,
      staffAnalytics,
      hardwareStats,
      taskStats,
      screens
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardAnalytics
};