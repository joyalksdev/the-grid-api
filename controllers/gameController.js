// backend/controllers/gameController.js
const Game = require('../models/Game');
const { GAME_MODES, GAME_PLATFORMS } = require('../models/Game');
const { getIO } = require('../socket');
const {
  uploadGameImage,
  deleteGameFolder,
} = require('../services/cloudinaryService');

const POPULATE_SCREENS = ['availableScreens', 'screenId name type status'];
const POPULATE_HARDWARE = ['assignedHardware', 'assetId name category status station'];

/* ----------------------------- helpers ----------------------------- */

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'game';
}

async function generateUniqueSlug(title, excludeId = null) {
  const base = slugify(title);
  let slug = base;
  let counter = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await Game.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${base}-${counter++}`;
  }
  return slug;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// FormData sends arrays as JSON strings; JSON requests send real arrays
function parseArray(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed];
    } catch {
      return value.split(',').map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function parseNumber(value) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalises & validates the game body from either JSON or multipart FormData.
 * Returns { data, error }
 */
function buildGamePayload(body) {
  const data = {};

  if (body.title !== undefined) data.title = String(body.title).trim();
  if (body.genre !== undefined) data.genre = String(body.genre).trim();
  if (body.description !== undefined) data.description = String(body.description).trim();

  if (body.platform !== undefined) {
    if (!GAME_PLATFORMS.includes(body.platform)) {
      return { error: `Platform must be one of: ${GAME_PLATFORMS.join(', ')}` };
    }
    data.platform = body.platform;
  }

  const supportedModes = parseArray(body.supportedModes);
  if (supportedModes !== undefined) {
    const invalid = supportedModes.filter((m) => !GAME_MODES.includes(m));
    if (invalid.length) return { error: `Invalid mode(s): ${invalid.join(', ')}` };
    if (!supportedModes.length) return { error: 'Select at least one supported mode' };
    data.supportedModes = [...new Set(supportedModes)];
  }

  if (body.recommendedMode !== undefined && body.recommendedMode !== '') {
    if (!GAME_MODES.includes(body.recommendedMode)) {
      return { error: 'Invalid recommended mode' };
    }
    data.recommendedMode = body.recommendedMode;
  }

  const minPlayers = parseNumber(body.minPlayers);
  const maxPlayers = parseNumber(body.maxPlayers);
  if (minPlayers !== undefined) data.minPlayers = Math.min(Math.max(minPlayers, 1), 4);
  if (maxPlayers !== undefined) data.maxPlayers = Math.min(Math.max(maxPlayers, 1), 4);

  const availableScreens = parseArray(body.availableScreens);
  const assignedHardware = parseArray(body.assignedHardware);
  if (availableScreens !== undefined) data.availableScreens = availableScreens;
  if (assignedHardware !== undefined) data.assignedHardware = assignedHardware;

  const isFeatured = parseBoolean(body.isFeatured);
  const isActive = parseBoolean(body.isActive);
  if (isFeatured !== undefined) data.isFeatured = isFeatured;
  if (isActive !== undefined) data.isActive = isActive;

  return { data };
}

// Keeps recommendedMode inside supportedModes and min <= max
function reconcilePlayConfig(game) {
  if (!game.supportedModes?.length) game.supportedModes = ['Single'];
  if (!game.supportedModes.includes(game.recommendedMode)) {
    game.recommendedMode = game.supportedModes[0];
  }
  if (game.minPlayers > game.maxPlayers) game.minPlayers = game.maxPlayers;
}

async function findPopulatedGame(id) {
  return Game.findById(id)
    .populate(...POPULATE_SCREENS)
    .populate(...POPULATE_HARDWARE);
}

function emit(event, payload) {
  try {
    const io = getIO();
    if (io) io.emit(event, payload);
  } catch (_) {
    // Socket not initialised
  }
}

/* ---------------------------- controllers ---------------------------- */

// @desc    Get all games with linked screen and hardware details
// @route   GET /api/games
const getGames = async (req, res) => {
  try {
    const games = await Game.find({})
      .populate(...POPULATE_SCREENS)
      .populate(...POPULATE_HARDWARE)
      .sort({ isFeatured: -1, title: 1 });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
};

// @desc    Get supported modes & platforms for the admin form
// @route   GET /api/games/options
const getGameOptions = async (req, res) => {
  res.json({ modes: GAME_MODES, platforms: GAME_PLATFORMS });
};

// @desc    Create a game with thumbnail + cover uploaded to Games/<slug>/
// @route   POST /api/games   (multipart/form-data)
const createGame = async (req, res) => {
  const { data, error } = buildGamePayload(req.body);
  if (error) return res.status(400).json({ error });

  if (!data.title || !data.genre) {
    return res.status(400).json({ error: 'Game title and genre are required' });
  }

  const thumbnailFile = req.files?.thumbnail?.[0];
  const coverFile = req.files?.cover?.[0];
  if (!thumbnailFile || !coverFile) {
    return res
      .status(400)
      .json({ error: 'Both a thumbnail image and a cover image are required' });
  }

  let slug;
  try {
    const existing = await Game.findOne({
      title: { $regex: new RegExp(`^${escapeRegex(data.title)}$`, 'i') },
    });
    if (existing) {
      return res.status(400).json({ error: 'A game with this title already exists' });
    }

    slug = await generateUniqueSlug(data.title);

    const [thumbnail, cover] = await Promise.all([
      uploadGameImage(thumbnailFile.buffer, slug, 'thumbnail'),
      uploadGameImage(coverFile.buffer, slug, 'cover'),
    ]);

    const game = new Game({ ...data, slug, thumbnail, cover });
    reconcilePlayConfig(game);
    await game.save();

    const populatedGame = await findPopulatedGame(game._id);
    emit('game_created', populatedGame);

    res.status(201).json(populatedGame);
  } catch (err) {
    console.error('Create game error:', err.message);
    // Roll back any images already uploaded for this slug
    if (slug) await deleteGameFolder(slug);
    res.status(500).json({ error: err.message || 'Failed to create game' });
  }
};

// @desc    Update game details, play config, station links, and optionally replace images
// @route   PUT /api/games/:id   (multipart/form-data or JSON)
const updateGame = async (req, res) => {
  const { data, error } = buildGamePayload(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (data.title && data.title.toLowerCase() !== game.title.toLowerCase()) {
      const duplicate = await Game.findOne({
        _id: { $ne: game._id },
        title: { $regex: new RegExp(`^${escapeRegex(data.title)}$`, 'i') },
      });
      if (duplicate) {
        return res.status(400).json({ error: 'A game with this title already exists' });
      }
    }

    // Legacy games created before slugs existed get one now
    if (!game.slug) {
      game.slug = await generateUniqueSlug(data.title || game.title, game._id);
    }

    // Replace images only if new files were sent (same public_id => overwrite)
    const thumbnailFile = req.files?.thumbnail?.[0];
    const coverFile = req.files?.cover?.[0];
    const [thumbnail, cover] = await Promise.all([
      thumbnailFile ? uploadGameImage(thumbnailFile.buffer, game.slug, 'thumbnail') : null,
      coverFile ? uploadGameImage(coverFile.buffer, game.slug, 'cover') : null,
    ]);

    Object.assign(game, data);
    if (thumbnail) game.thumbnail = thumbnail;
    if (cover) game.cover = cover;
    reconcilePlayConfig(game);

    await game.save();

    const updatedGame = await findPopulatedGame(game._id);
    emit('game_updated', updatedGame);

    res.json(updatedGame);
  } catch (err) {
    console.error('Update game error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update game' });
  }
};

// @desc    Delete a game and its Cloudinary folder (Games/<slug>)
// @route   DELETE /api/games/:id
const deleteGame = async (req, res) => {
  try {
    const game = await Game.findByIdAndDelete(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    await deleteGameFolder(game.slug);
    emit('game_deleted', { id: req.params.id });

    res.json({ message: 'Game deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete game' });
  }
};

module.exports = {
  getGames,
  getGameOptions,
  createGame,
  updateGame,
  deleteGame,
};
