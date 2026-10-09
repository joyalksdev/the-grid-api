// controllers/hardwareController.js
const HardwareDevice = require('../models/HardwareDevice');
const ServiceLog = require('../models/ServiceLog');
const { getIO } = require('../socket');

/**
 * @desc    Get all hardware devices with optional type/status filter
 * @route   GET /api/hardware
 */
const getDevices = async (req, res, next) => {
  try {
    const { type, status, search } = req.query;
    const query = {};

    if (type && type !== 'all') query.type = type;
    if (status && status !== 'all') query.status = status;
    if (search && search.trim()) {
      query.$or = [
        { tagId: { $regex: search.trim(),$options: 'i' } },
        { name: { $regex: search.trim(),$options: 'i' } },
        { assignedScreen: { $regex: search.trim(),$options: 'i' } },
      ];
    }

    const devices = await HardwareDevice.find(query).sort({ tagId: 1 }).lean();
    res.json(devices);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Register a new hardware device with a unique Sticker Tag ID
 * @route   POST /api/hardware
 */
const createDevice = async (req, res, next) => {
  try {
    const { tagId, name, type, assignedScreen, condition, notes } = req.body;

    const existing = await HardwareDevice.findOne({ tagId: tagId.toUpperCase() });
    if (existing) {
      return res.status(400).json({ error: `Hardware tag ${tagId.toUpperCase()} is already in use` });
    }

    const newDevice = await HardwareDevice.create({
      tagId: tagId.toUpperCase(),
      name,
      type,
      assignedScreen: assignedScreen || 'Unassigned',
      condition: condition || 'good',
      notes,
    });

    getIO().emit('hardware_created', newDevice);

    res.status(201).json(newDevice);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update device details or status
 * @route   PUT /api/hardware/:id
 */
const updateDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, type, assignedScreen, status, condition, notes } = req.body;

    const updatedDevice = await HardwareDevice.findByIdAndUpdate(
      id,
      { name, type, assignedScreen, status, condition, notes },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    getIO().emit('hardware_updated', updatedDevice);

    res.json(updatedDevice);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new maintenance/service log entry for a device
 * @route   POST /api/hardware/:id/service
 */
const createServiceLog = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { issueDescription, actionTaken, cost, status } = req.body;

    const device = await HardwareDevice.findById(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const serviceLog = await ServiceLog.create({
      device: device._id,
      tagId: device.tagId,
      issueDescription,
      actionTaken,
      servicedBy: req.user._id,
      cost: Number(cost) || 0,
      status: status || 'reported',
      resolvedAt: status === 'resolved' ? new Date() : null,
    });

    // Update Device Service Stats & Status automatically
    device.totalServiceCount += 1;
    device.lastServicedAt = new Date();
    if (status === 'in_repair' || status === 'reported') {
      device.status = 'maintenance';
    } else if (status === 'resolved') {
      device.status = 'repaired';
    }
    await device.save();

    const populatedLog = await ServiceLog.findById(serviceLog._id)
      .populate('servicedBy', 'name role')
      .lean();

    getIO().emit('service_log_created', populatedLog);
    getIO().emit('hardware_updated', device);

    res.status(201).json({ serviceLog: populatedLog, device });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all service logs for a specific device or all devices across the lounge
 * @route   GET /api/hardware/service-logs
 */
const getAllServiceLogs = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;

    const logs = await ServiceLog.find(query)
      .populate('device', 'name tagId type assignedScreen')
      .populate('servicedBy', 'name role')
      .sort({ createdAt: -1 })
      .lean();

    res.json(logs);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update service log repair status (e.g. resolve issue & record final cost)
 * @route   PUT /api/hardware/service-logs/:logId
 */
const updateServiceLog = async (req, res, next) => {
  try {
    const { logId } = req.params;
    const { actionTaken, cost, status } = req.body;

    const updateData = {};
    if (actionTaken !== undefined) updateData.actionTaken = actionTaken;
    if (cost !== undefined) updateData.cost = Number(cost);
    if (status) {
      updateData.status = status;
      if (status === 'resolved') updateData.resolvedAt = new Date();
    }

    const log = await ServiceLog.findByIdAndUpdate(logId, updateData, {
      new: true,
      runValidators: true,
    })
      .populate('device')
      .populate('servicedBy', 'name role');

    if (!log) {
      return res.status(404).json({ error: 'Service log not found' });
    }

    // Sync device status if resolved
    if (status === 'resolved' && log.device) {
      await HardwareDevice.findByIdAndUpdate(log.device._id, {
        status: 'active',
        condition: 'good',
      });
    }

    getIO().emit('service_log_updated', log);

    res.json(log);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDevices,
  createDevice,
  updateDevice,
  createServiceLog,
  getAllServiceLogs,
  updateServiceLog,
};