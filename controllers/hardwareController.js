// backend/controllers/hardwareController.js
const Hardware = require('../models/HardwareDevice');

// @desc    Get all hardware items with filtering & search
// @route   GET /api/hardware
// @access  Private
const getHardware = async (req, res) => {
  try {
    const { category, status, search } = req.query;
    let query = {};

    if (category && category !== 'all') {
      query.category = { $regex: new RegExp(`^${category}$`, 'i') };
    }
    if (status && status !== 'all') {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { assetId: { $regex: search, $options: 'i' } },
        { serialNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const hardware = await Hardware.find(query).sort({ createdAt: -1 });
    res.status(200).json(hardware);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to fetch hardware assets' });
  }
};

// @desc    Register new hardware asset
// @route   POST /api/hardware
// @access  Private (Admin/Owner)
const createHardware = async (req, res) => {
  try {
    const { name, category, station, serialNumber, image } = req.body;

    if (!name || !category || !serialNumber) {
      return res.status(400).json({ message: 'Name, category, and serial number are required' });
    }

    const existingSerial = await Hardware.findOne({ serialNumber });
    if (existingSerial) {
      return res.status(400).json({ message: 'An asset with this serial number already exists' });
    }

    const prefix = category.substring(0, 3).toUpperCase();
    const randomNum = Math.floor(10 + Math.random() * 90);
    const assetId = `HW-${prefix}-${randomNum}`;

    const hardware = await Hardware.create({
      assetId,
      name,
      category,
      station: station || 'Storage / Spare',
      serialNumber,
      image: image || undefined,
      status: 'active',
      lastMaintenance: new Date(),
    });

    res.status(201).json(hardware);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to register hardware' });
  }
};

// @desc    Update hardware asset details
// @route   PUT /api/hardware/:id
// @access  Private (Admin/Owner)
const updateHardware = async (req, res) => {
  try {
    const hardware = await Hardware.findById(req.params.id);
    if (!hardware) {
      return res.status(404).json({ message: 'Hardware asset not found' });
    }

    hardware.name = req.body.name || hardware.name;
    hardware.category = req.body.category || hardware.category;
    hardware.station = req.body.station || hardware.station;
    hardware.serialNumber = req.body.serialNumber || hardware.serialNumber;
    hardware.image = req.body.image || hardware.image;
    hardware.status = req.body.status || hardware.status;

    const updated = await hardware.save();
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update hardware' });
  }
};

// @desc    Report issue and move asset to maintenance
// @route   PATCH /api/hardware/:id/issue
// @access  Private
const reportIssue = async (req, res) => {
  try {
    const { category, priority, description } = req.body;
    const hardware = await Hardware.findById(req.params.id);

    if (!hardware) {
      return res.status(404).json({ message: 'Hardware asset not found' });
    }

    hardware.status = 'maintenance';
    hardware.activeIssue = {
      category: category || 'General Hardware',
      priority: priority || 'medium',
      description: description || 'Issue reported by staff',
      reportedAt: new Date(),
    };

    await hardware.save();
    res.status(200).json({ message: 'Asset flagged for maintenance', hardware });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to report hardware issue' });
  }
};

// @desc    Resolve issue, log maintenance history, and reactivate hardware
// @route   PATCH /api/hardware/:id/resolve
// @access  Private
const resolveIssue = async (req, res) => {
  try {
    const { resolutionType, notes } = req.body;
    const hardware = await Hardware.findById(req.params.id);

    if (!hardware) {
      return res.status(404).json({ message: 'Hardware asset not found' });
    }

    hardware.maintenanceHistory.push({
      resolutionType: resolutionType || 'Serviced',
      notes: notes || 'No additional notes provided',
      resolvedAt: new Date(),
    });

    hardware.status = 'active';
    hardware.activeIssue = undefined;
    hardware.lastMaintenance = new Date();

    await hardware.save();
    res.status(200).json({ message: 'Hardware reactivated successfully', hardware });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to resolve hardware issue' });
  }
};

// @desc    Delete hardware asset permanently
// @route   DELETE /api/hardware/:id
// @access  Private (Admin/Owner)
const deleteHardware = async (req, res) => {
  try {
    const hardware = await Hardware.findById(req.params.id);

    if (!hardware) {
      return res.status(404).json({ message: 'Hardware asset not found' });
    }

    await hardware.deleteOne();
    res.status(200).json({ message: 'Hardware asset permanently deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete hardware asset' });
  }
};

module.exports = {
  getHardware,
  createHardware,
  updateHardware,
  reportIssue,
  resolveIssue,
  deleteHardware,
};