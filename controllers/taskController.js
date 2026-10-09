// controllers/taskController.js
const Task = require('../models/Task');
const { getIO } = require('../socket');

/**
 * @desc    Get all tasks with optional status & category filtering
 * @route   GET /api/tasks
 */
const getTasks = async (req, res, next) => {
  try {
    const { status, category, priority } = req.query;
    const query = {};

    if (status && status !== 'all') query.status = status;
    if (category && category !== 'all') query.category = category;
    if (priority && priority !== 'all') query.priority = priority;

    const tasks = await Task.find(query)
      .populate('assignedTo', 'name email avatar role')
      .populate('createdBy', 'name role')
      .populate('completedBy', 'name role')
      .sort({ createdAt: -1 })
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
    const { title, description, category, priority, assignedTo, dueDate, notes } = req.body;

    const newTask = await Task.create({
      title,
      description,
      category,
      priority,
      assignedTo: assignedTo || null,
      createdBy: req.user._id,
      dueDate: dueDate ? new Date(dueDate) : null,
      notes,
    });

    const populatedTask = await Task.findById(newTask._id)
      .populate('assignedTo', 'name email avatar role')
      .populate('createdBy', 'name role')
      .lean();

    // Broadcast Socket Event
    getIO().emit('task_created', populatedTask);

    res.status(201).json(populatedTask);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update task status (pending -> in_progress -> completed -> verified) & broadcast
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
      .populate('assignedTo', 'name email avatar role')
      .populate('createdBy', 'name role')
      .populate('completedBy', 'name role')
      .lean();

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Broadcast Socket Event
    getIO().emit('task_status_changed', updatedTask);

    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update full task details
 * @route   PUT /api/tasks/:id
 */
const updateTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, category, priority, assignedTo, dueDate, notes } = req.body;

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        title,
        description,
        category,
        priority,
        assignedTo: assignedTo || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes,
      },
      { new: true, runValidators: true }
    )
      .populate('assignedTo', 'name email avatar role')
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