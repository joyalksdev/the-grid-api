// controllers/taskController.js
const Task = require('../models/Task');
const { getIO } = require('../socket');

/**
 * @desc    Get all tasks with optional status, taskType, & priority filtering
 * @route   GET /api/tasks
 */
const getTasks = async (req, res, next) => {
  try {
    const { status, taskType, priority } = req.query;
    const query = {};

    if (status && status !== 'all') query.status = status;
    if (taskType && taskType !== 'all') query.taskType = taskType;
    if (priority && priority !== 'all') query.priority = priority;

    const tasks = await Task.find(query)
      .populate('assignedTo', 'name email avatar role status isActive')
      .populate('createdBy', 'name role')
      .populate('completedBy', 'name role')
      .sort({ orderIndex: 1, createdAt: -1 })
      .lean();

    res.json(tasks);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new task & broadcast via Socket
 * @route   POST /api/tasks
 */
const createTask = async (req, res, next) => {
  try {
    const { title, description, taskType, priority, assignedTo, scheduledFor, notes } = req.body;

    const newTask = await Task.create({
      title,
      description,
      taskType: taskType || 'daily',
      priority: priority || 'medium',
      assignedTo: assignedTo || null,
      createdBy: req.user._id,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      notes,
    });

    const populatedTask = await Task.findById(newTask._id)
      .populate('assignedTo', 'name email avatar role status isActive')
      .populate('createdBy', 'name role')
      .lean();

    // Instant Socket Broadcast
    getIO().emit('task_created', populatedTask);

    res.status(201).json(populatedTask);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update task status & broadcast via Socket
 * @route   PATCH /api/tasks/:id/status
 */
const updateTaskStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const updateData = { status };
    if (notes !== undefined) updateData.notes = notes;

    if (status === 'completed' || status === 'verified') {
      updateData.completedBy = req.user._id;
      updateData.completedAt = new Date();
    } else if (status === 'pending' || status === 'in_progress') {
      updateData.completedBy = null;
      updateData.completedAt = null;
    }

    const updatedTask = await Task.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate('assignedTo', 'name email avatar role status isActive')
      .populate('createdBy', 'name role')
      .populate('completedBy', 'name role')
      .lean();

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Instant Socket Broadcast
    getIO().emit('task_status_changed', updatedTask);

    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update full task details & broadcast
 * @route   PUT /api/tasks/:id
 */
const updateTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, taskType, priority, assignedTo, scheduledFor, notes } = req.body;

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        title,
        description,
        taskType,
        priority,
        assignedTo: assignedTo || null,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        notes,
      },
      { new: true, runValidators: true }
    )
      .populate('assignedTo', 'name email avatar role status isActive')
      .populate('createdBy', 'name role')
      .populate('completedBy', 'name role')
      .lean();

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    getIO().emit('task_updated', updatedTask);

    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a task & broadcast
 * @route   DELETE /api/tasks/:id
 */
const deleteTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deletedTask = await Task.findByIdAndDelete(id);

    if (!deletedTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    getIO().emit('task_deleted', { id });

    res.json({ message: 'Task deleted successfully', id });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTasks,
  createTask,
  updateTaskStatus,
  updateTask,
  deleteTask,
};