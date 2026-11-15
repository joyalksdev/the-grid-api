// backend/jobs/taskScheduler.js
const cron = require('node-cron');
const Task = require('../models/Task');
const Booking = require('../models/Booking');
const { getIO, releaseSlotLock } = require('../socket');

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

  // 3. Minute Check for Expired Pending Bookings (Auto-release after 15 mins)
  cron.schedule('* * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 15 * 60 * 1000);
      const expiredPending = await Booking.find({
        status: 'pending',
        $or: [
          { expiresAt: { $ne: null, $lte: new Date() } },
          { createdAt: { $lte: cutoff } },
        ],
      });

      if (expiredPending.length > 0) {
        for (const b of expiredPending) {
          await Booking.findByIdAndDelete(b._id);
          const scrCode = b.station
            ? `Screen${(b.station.match(/(\d+)/) || [null, '1'])[1]}`
            : 'Screen1';
          releaseSlotLock(scrCode, b.date, b.startTime);
        }

        try {
          const io = getIO();
          if (io) {
            io.emit('booking_deleted', { message: 'Expired pending bookings auto-released' });
            io.emit('slot_unlocked');
          }
        } catch (_) {}

        console.log(`🧹 Auto-released ${expiredPending.length} expired pending bookings`);
      }
    } catch (error) {
      console.error('Error auto-releasing expired pending bookings:', error.message);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });
};

module.exports = initTaskScheduler;