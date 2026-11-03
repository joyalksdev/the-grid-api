// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const connectDB = require('./config/db');
const { initSocket } = require('./socket');
const initTaskScheduler = require('./jobs/taskScheduler');

// Import modularized security rate limiters
const { 
  globalLimiter, 
  authLimiter, 
  passwordResetLimiter 
} = require('./middleware/rateLimiters');

dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Server recovery active...');
  console.error(err.name, err.message, err.stack);
});

connectDB();

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : [];

const allowedOrigins = [
  ...envOrigins,
  'https://gridgaming.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy blocks this origin'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

initSocket(server, allowedOrigins);
initTaskScheduler();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

// 1. Apply Global Rate Limiter to all incoming API traffic
app.use('/api', globalLimiter);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(mongoSanitize());
app.use(hpp());

// 2. Apply Targeted Granular Limiters to Authentication Routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', passwordResetLimiter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'The Grid Arena API is running',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/screens', require('./routes/screenRoutes'));
app.use('/api/pricing', require('./routes/pricingRoutes'));
app.use('/api/logs', require('./routes/logRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/hardware', require('./routes/hardwareRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('🔴 API Error Caught:', err.message);

  if (err.message === 'CORS policy blocks this origin') {
    return res.status(403).json({ error: err.message });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(400).json({
      error: `Duplicate entry: A record with that ${field} already exists.`,
    });
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({ error: messages.join(', ') });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🎮 The Grid Arena API & WebSocket Server running on port ${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error('💥 UNHANDLED REJECTION! Server recovery active...');
  console.error(err);
});

module.exports = app;