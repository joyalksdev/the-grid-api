// backend/socket.js
const { Server } = require('socket.io');

let io;

const initSocket = (server, allowedOrigins) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    transports: ['polling', 'websocket'], // Explicitly support HTTP polling fallback
    allowEIO3: true,                      // Compatibility mode for Engine.IO
  });

  io.on('connection', (socket) => {
    console.log(`⚡ Socket connected: ${socket.id}`);

    socket.on('join_screen', (screenId) => {
      socket.join(`screen_${screenId}`);
    });

    socket.on('disconnect', (reason) => {
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

module.exports = { initSocket, getIO };