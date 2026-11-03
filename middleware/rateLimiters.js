// backend/middleware/rateLimiters.js
const rateLimit = require('express-rate-limit');

// 1. Global API Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please try again later.' },
});

// 2. Strict Auth / Login Limiter (Skips successful requests so shared IPs aren't locked out)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8, // 8 failed attempts allowed
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Successful logins never count towards rate locks
  message: { error: 'Too many failed login attempts. Please try again after 15 minutes.' },
});

// 3. Sensitive Action Limiter (For Password Reset / Recovery requests)
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 3, // Max 3 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again in an hour.' },
});

module.exports = {
  globalLimiter,
  authLimiter,
  passwordResetLimiter,
};