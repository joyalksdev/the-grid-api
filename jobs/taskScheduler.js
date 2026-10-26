// backend/jobs/taskScheduler.js
const cron = require('node-cron');
const Task = require('../models/Task');
const { getIO } = require('../socket');

const initTaskScheduler = () => {
  console.log('⏰ Task scheduler initialized');

  // 1. Midnight Rollover (00:00 every day)
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('🔄 Running midnight daily task lifecycle check...');

      // A. If a daily task was COMPLETED today -> Reset it to pending for the new day
      await Task.updateMany(
        { taskType: 'daily', status: { $in: ['completed', 'verified'] } },
        {
          $set: {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            isOverdue: false,
            lastResetAt: new Date(),
          },
        }
      );

      // B. If a daily task was NOT completed (still pending) -> Flag as OVERDUE + escalate priority to URGENT
      await Task.updateMany(
        { taskType: 'daily', status: 'pending' },
        {
          $set: {
            isOverdue: true,
            priority: 'urgent',
          },
        }
      );

      // Notify all connected frontend screens to refresh their boards
      getIO().emit('tasks_rolled_over');
    } catch (error) {
      console.error('Error during midnight task rollover:', error);
    }
  });

  // 2. Minute Check for Scheduled Task Timers
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // Find scheduled tasks whose time has arrived and haven't triggered a pop-up alert yet
      const dueScheduledTasks = await Task.find({
        taskType: 'scheduled',
        status: 'pending',
        isNotified: false,
        scheduledFor: { $lte: now },
      }).populate('assignedTo', 'name username role');

      for (const task of dueScheduledTasks) {
        task.isNotified = true;
        await task.save();

        // Broadcast Socket event ready for your notification engine
        getIO().emit('scheduled_task_due', {
          taskId: task._id,
          title: task.title,
          description: task.description,
          assignedTo: task.assignedTo,
          priority: task.priority,
          scheduledFor: task.scheduledFor,
        });
      }
    } catch (error) {
      console.error('Error checking scheduled task timers:', error);
    }
  });
};

module.exports = initTaskScheduler;