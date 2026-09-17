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

// Required when deploying behind reverse proxies (Render, Railway, Cloudflare, Heroku)
// Ensures correct client IP detection for rate limiters
app.set('trust proxy', 1);

// Configure CORS Options (supports single URL or comma-separated origins)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : ['http://localhost:5173'];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server or non-browser tools (like Postman) with no origin
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy blocks this origin'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Production Security Headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
  })
);

// Global API Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' }
});

// Strict Auth Rate Limiter (Brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login/register attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: { error: 'Too many failed login attempts. Please try again after 15 minutes.' }
});

// Apply Global Rate Limiting
app.use('/api', globalLimiter);

// Body Parsers & Data Sanitization
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(mongoSanitize()); // Prevent NoSQL Injection
app.use(hpp()); // Prevent HTTP Parameter Pollution

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'The Grid Arena API is running',
    timestamp: new Date().toISOString()
  });
});

// API Routes with Endpoint-Specific Limiters
app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/screens', require('./routes/screenRoutes'));
app.use('/api/logs', require('./routes/logRoutes'));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Express Error Middleware
app.use((err, req, res, next) => {
  console.error('🔴 API Error Caught:', err.message);

  // CORS rejection handling
  if (err.message === 'CORS policy blocks this origin') {
    return res.status(403).json({ error: err.message });
  }

  // Catch MongoDB duplicate key index errors (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(400).json({
      error: `Duplicate entry: A record with that ${field} already exists.`
    });
  }

  // Catch Mongoose Validation Errors
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