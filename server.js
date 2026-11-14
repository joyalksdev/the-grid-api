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
const Waitlist = require('./models/Waitlist.js');
const rateLimit = require('express-rate-limit');


// Import modularized security rate limiters
const { 
  globalLimiter, 
  authLimiter, 
  passwordResetLimiter 
} = require('./middleware/rateLimiters');

dotenv.config();

// Configurable Booking Charges (convenience fee & tax)
const CONVENIENCE_FEE = Number(
  process.env.CONVENIENCE_FEE !== undefined && process.env.CONVENIENCE_FEE !== ''
    ? process.env.CONVENIENCE_FEE
    : 15
);
const GST_PERCENT = Number(
  process.env.GST_PERCENT !== undefined && process.env.GST_PERCENT !== ''
    ? process.env.GST_PERCENT
    : 18
);
console.log(
  `[Config] Booking fees active: Convenience Fee = ₹${CONVENIENCE_FEE}, GST = ${GST_PERCENT}%`
);

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
  'https://thegridgaming.fun',
  'https://www.thegridgaming.fun',
  'https://app.thegridgaming.fun',
  'https://gridgaming.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5500',
];

const corsOptions = {
  origin: (origin, callback) => {
    const isLocalhost =
      origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    const isVercelPreview = origin && /\.vercel\.app$/i.test(origin);

    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      isLocalhost ||
      isVercelPreview
    ) {
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

app.use(
  express.json({
    limit: '10kb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(mongoSanitize());
app.use(hpp());

// 2. Apply Targeted Granular Limiters to Authentication Routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/public/auth/send-otp', authLimiter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'The Grid Arena API is running',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/public', require('./routes/publicRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/screens', require('./routes/screenRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'))
app.use('/api/games', require('./routes/gameRoutes'))
app.use('/api/customers', require('./routes/customerRoutes'))
app.use('/api/pricing', require('./routes/pricingRoutes'));
app.use('/api/logs', require('./routes/logRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/hardware', require('./routes/hardwareRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));



const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 submissions per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
});

app.post('/api/public/waitlist', waitlistLimiter, async (req, res) => {
  try {
    const contact = typeof req.body.contact === 'string' ? req.body.contact.trim() : '';
    if (contact.length < 5 || contact.length > 100) {
      return res.status(400).json({ message: 'Please enter a valid WhatsApp number or email.' });
    }

    await Waitlist.findOneAndUpdate(
      { contact },
      { contact },
      { upsert: true, new: true }
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Waitlist Error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});



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