const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const connectDB = require('./config/db');

dotenv.config();

// Prevent server crashes from unhandled synchronous errors
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Server recovery active...');
  console.error(err.name, err.message, err.stack);
});

connectDB();

const app = express();

// Configure CORS Options
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' }
});
app.use('/api', globalLimiter);

// Body Parsers & Middlewares
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(hpp());

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'The Grid Arena API is running',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/screens', require('./routes/screenRoutes'));
app.use('/api/logs', require('./routes/logRoutes'));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Express Error Middleware
app.use((err, req, res, next) => {
  console.error('🔴 API Error Caught:', err.message);

  // Catch duplicate key index errors (E11000) without crashing
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(400).json({
      error: `Duplicate entry: A record with that ${field} already exists.`
    });
  }

  // Catch Mongoose Validation Errors (e.g. invalid enum)
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({ error: messages.join(', ') });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🎮 The Grid Arena API Server running on port ${PORT}`);
});

// Prevent server crashes from unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('💥 UNHANDLED REJECTION! Server recovery active...');
  console.error(err);
});

module.exports = app;