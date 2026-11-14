// backend/socket.js
const { Server } = require('socket.io');

let io;

// In-memory 5-minute TTL slot lock registry
// key: `${screenCode}_${date}_${startTime}` -> { screenCode, date, startTime, duration, socketId, expiresAt, timeoutId }
const slotLocks = new Map();
const LOCK_TTL_MS = 5 * 60 * 1000; // 300 seconds (5 minutes)

const serializeLocks = (filterDate = null) => {
  const now = Date.now();
  const active = [];
  for (const [key, lock] of slotLocks.entries()) {
    if (lock.expiresAt <= now) {
      clearTimeout(lock.timeoutId);
      slotLocks.delete(key);
      continue;
    }
    if (!filterDate || lock.date === filterDate) {
      active.push({
        key,
        screenCode: lock.screenCode,
        date: lock.date,
        startTime: lock.startTime,
        duration: lock.duration,
        socketId: lock.socketId,
        expiresAt: lock.expiresAt,
      });
    }
  }
  return active;
};

const broadcastLocks = () => {
  if (!io) return;
  io.emit('slots_locked_updated', serializeLocks());
};

const releaseSlotLock = (screenCode, date, startTime) => {
  const key = `${screenCode}_${date}_${startTime}`;
  const existing = slotLocks.get(key);
  if (existing) {
    clearTimeout(existing.timeoutId);
    slotLocks.delete(key);
    broadcastLocks();
    return true;
  }
  return false;
};

const initSocket = (server, allowedOrigins) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        const isLocalhost =
          origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
        const isVercelPreview = origin && /\.vercel\.app$/i.test(origin);
        if (
          !origin ||
          (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) ||
          isLocalhost ||
          isVercelPreview
        ) {
          callback(null, true);
        } else {
          callback(new Error('CORS policy blocks this origin'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    transports: ['polling', 'websocket'], // Explicitly support HTTP polling fallback
    allowEIO3: true,                      // Compatibility mode for Engine.IO
  });

  io.on('connection', (socket) => {
    console.log(`⚡ Socket connected: ${socket.id}`);

    // Send current locked slots on connect
    socket.emit('slots_locked_updated', serializeLocks());

    socket.on('join_screen', (screenId) => {
      socket.join(`screen_${screenId}`);
    });

    // Register user-specific private room for real-time status updates/kick-outs
    socket.on('join_user', (userId) => {
      if (userId) {
        socket.join(`user_${userId}`);
        console.log(`👤 User joined private room: user_${userId}`);
      }
    });

    // Real-time 5-minute slot locking for online booking flow
    socket.on('lock_slot', (payload = {}) => {
      const { screenCode, date, startTime, duration = 60 } = payload;
      if (!screenCode || !date || !startTime) return;

      // Release any previous locks owned by this same socket so one user only locks one slot at a time
      for (const [k, l] of slotLocks.entries()) {
        if (l.socketId === socket.id && k !== `${screenCode}_${date}_${startTime}`) {
          clearTimeout(l.timeoutId);
          slotLocks.delete(k);
        }
      }

      const key = `${screenCode}_${date}_${startTime}`;
      const existing = slotLocks.get(key);
      const now = Date.now();

      // If locked by another active socket, do not overwrite
      if (existing && existing.expiresAt > now && existing.socketId !== socket.id) {
        socket.emit('slot_lock_rejected', {
          screenCode,
          date,
          startTime,
          reason: 'This time slot is currently being booked by another player.',
        });
        return;
      }

      if (existing) {
        clearTimeout(existing.timeoutId);
      }

      const expiresAt = now + LOCK_TTL_MS;
      const timeoutId = setTimeout(() => {
        slotLocks.delete(key);
        broadcastLocks();
      }, LOCK_TTL_MS);

      slotLocks.set(key, {
        screenCode,
        date,
        startTime,
        duration: Number(duration) || 60,
        socketId: socket.id,
        expiresAt,
        timeoutId,
      });

      broadcastLocks();
    });

    socket.on('release_slot', (payload = {}) => {
      const { screenCode, date, startTime } = payload;
      if (!screenCode || !date || !startTime) return;
      const key = `${screenCode}_${date}_${startTime}`;
      const existing = slotLocks.get(key);
      if (existing && existing.socketId === socket.id) {
        clearTimeout(existing.timeoutId);
        slotLocks.delete(key);
        broadcastLocks();
      }
    });

    socket.on('disconnect', (reason) => {
      let changed = false;
      for (const [k, l] of slotLocks.entries()) {
        if (l.socketId === socket.id) {
          clearTimeout(l.timeoutId);
          slotLocks.delete(k);
          changed = true;
        }
      }
      if (changed) {
        broadcastLocks();
      }
      console.log(`❌ Socket disconnected (${socket.id}): ${reason}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io has not been initialized!');
  }
  return io;
};

module.exports = {
  initSocket,
  getIO,
  getActiveSlotLocks: serializeLocks,
  releaseSlotLock,
};
