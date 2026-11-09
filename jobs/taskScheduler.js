// backend/jobs/taskScheduler.js
const cron = require('node-cron');
const Task = require('../models/Task');
const { getIO } = require('../socket');

const initTaskScheduler = () => {
  console.log('⏰ Task scheduler initialized');

  // 1. Midnight Rollover (00:00 every day IST)
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('🔄 Running midnight daily task lifecycle check...');

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // A. Flag uncompleted pending tasks from previous days as OVERDUE + URGENT FIRST
      await Task.updateMany(
        {
          taskType: 'daily',
          status: 'pending',
          lastResetAt: { $lt: startOfToday },
        },
        {
          $set: {
            isOverdue: true,
            priority: 'urgent',
          },
        }
      );

      // B. Reset completed or verified daily tasks to pending for the new day
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

      // Notify all connected frontend screens to refresh their boards
      getIO().emit('tasks_rolled_over');
      console.log('✅ Midnight task rollover completed successfully.');
    } catch (error) {
      console.error('Error during midnight task rollover:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // 2. Minute Check for Scheduled Task Timers
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      const dueScheduledTasks = await Task.find({
        taskType: 'scheduled',
        status: 'pending',
        isNotified: false,
        scheduledFor: { $lte: now },
      }).populate('assignedTo', 'name username role');

      for (const task of dueScheduledTasks) {
        task.isNotified = true;
        await task.save();

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
  }, {
    timezone: 'Asia/Kolkata',
  });
};

module.exports = initTaskScheduler;