// backend/services/cloudinaryService.js
const cloudinary = require('../config/cloudinary');

const GAMES_ROOT_FOLDER = 'Games';

/**
 * Builds the Cloudinary folder for a game: Games/<slug>
 */
function getGameFolder(slug) {
  return `${GAMES_ROOT_FOLDER}/${slug}`;
}

/**
 * Uploads an in-memory image buffer to Cloudinary.
 * Overwrites any existing asset with the same public_id so re-uploads replace cleanly.
 */
function uploadImageBuffer(buffer, { folder, publicId }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        overwrite: true,
        invalidate: true,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Uploads a game image (thumbnail or cover) into Games/<slug>/<type>
 */
function uploadGameImage(buffer, slug, type) {
  return uploadImageBuffer(buffer, {
    folder: getGameFolder(slug),
    publicId: type, // 'thumbnail' | 'cover'
  });
}

/**
 * Deletes a single asset by public_id (silently ignores failures)
 */
async function deleteImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (err) {
    console.error(`Cloudinary delete failed (${publicId}):`, err.message);
  }
}

/**
 * Removes every asset inside Games/<slug> and then the folder itself
 */
async function deleteGameFolder(slug) {
  if (!slug) return;
  const folder = getGameFolder(slug);
  try {
    await cloudinary.api.delete_resources_by_prefix(`${folder}/`);
    await cloudinary.api.delete_folder(folder);
  } catch (err) {
    console.error(`Cloudinary folder cleanup failed (${folder}):`, err.message);
  }
}

module.exports = {
  getGameFolder,
  uploadGameImage,
  deleteImage,
  deleteGameFolder,
};
