// backend/middleware/gameImageUpload.js
const multer = require('multer');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per image
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];

// Keep files in memory so the controller can upload them into Games/<slug>/
// after the game title/slug has been validated.
const gameImageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 2 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(
        new Error('Only JPG, PNG, WEBP or AVIF images are allowed')
      );
    }
    cb(null, true);
  },
}).fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

/**
 * Accepts `thumbnail` and `cover` image fields.
 * Non-multipart (JSON) requests pass straight through.
 * Multer errors are returned as clean 400 JSON responses.
 */
const gameImageUpload = (req, res, next) => {
  gameImageMulter(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Each image must be under 5MB' });
    }
    return res.status(400).json({ error: err.message || 'Image upload failed' });
  });
};

module.exports = gameImageUpload;
