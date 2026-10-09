// backend/middleware/upload.js
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Sanitize identifier so no illegal characters are sent to Cloudinary
    const rawId = req.user?.userId || req.user?._id || `staff_${Date.now()}`;
    const cleanId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '_');

    return {
      folder: 'staff_profiles',
      public_id: `avatar_${cleanId}`,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
      resource_type: 'image',
    };
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

module.exports = upload;