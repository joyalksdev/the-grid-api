// backend/test-cloudinary.js
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log('Testing Cloudinary credentials:');
console.log('CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('API_KEY:', process.env.CLOUDINARY_API_KEY ? 'Loaded' : 'MISSING');
console.log('API_SECRET:', process.env.CLOUDINARY_API_SECRET ? 'Loaded' : 'MISSING');

// Test account ping
cloudinary.api.ping((error, result) => {
  if (error) {
    console.error('\n❌ Cloudinary API Ping Failed:');
    console.error(error);
  } else {
    console.log('\n✅ Cloudinary Connection Successful!');
    console.log(result);
  }
});