// backend/controllers/gameController.js
const Game = require('../models/Game');
const { getIO } = require('../socket');

// @desc    Get all games with linked screen and hardware details
// @route   GET /api/games
const getGames = async (req, res) => {
  try {
    const games = await Game.find({})
      .populate('availableScreens', 'screenId name type status')
      .populate('assignedHardware', 'assetId name category status station')
      .sort({ title: 1 });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
};

// @desc    Add a new game and link screens & hardware assets
// @route   POST /api/games
const createGame = async (req, res) => {
  try {
    const { title, genre, platform, coverUrl, availableScreens, assignedHardware } = req.body;

    if (!title || !genre) {
      return res.status(400).json({ error: 'Game title and genre are required' });
    }

    const existing = await Game.findOne({ title: { $regex: new RegExp(`^${title}$`, 'i') } });
    if (existing) {
      return res.status(400).json({ error: 'A game with this title already exists' });
    }

    const game = await Game.create({
      title,
      genre,
      platform: platform || 'PS5',
      coverUrl: coverUrl || '',
      availableScreens: availableScreens || [],
      assignedHardware: assignedHardware || [],
    });

    const populatedGame = await Game.findById(game._id)
      .populate('availableScreens', 'screenId name type status')
      .populate('assignedHardware', 'assetId name category status station');

    const io = getIO();
    if (io) {
      io.emit('game_created', populatedGame);
    }

    res.status(201).json(populatedGame);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create game' });
  }
};

// @desc    Update game details, screen mappings, and hardware links
// @route   PUT /api/games/:id
const updateGame = async (req, res) => {
  try {
    const { title, genre, platform, coverUrl, availableScreens, assignedHardware, isActive } = req.body;
    const game = await Game.findById(req.params.id);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    game.title = title !== undefined ? title : game.title;
    game.genre = genre !== undefined ? genre : game.genre;
    game.platform = platform !== undefined ? platform : game.platform;
    game.coverUrl = coverUrl !== undefined ? coverUrl : game.coverUrl;
    game.availableScreens = availableScreens !== undefined ? availableScreens : game.availableScreens;
    game.assignedHardware = assignedHardware !== undefined ? assignedHardware : game.assignedHardware;
    game.isActive = isActive !== undefined ? isActive : game.isActive;

    await game.save();

    const updatedGame = await Game.findById(game._id)
      .populate('availableScreens', 'screenId name type status')
      .populate('assignedHardware', 'assetId name category status station');

    const io = getIO();
    if (io) {
      io.emit('game_updated', updatedGame);
    }

    res.json(updatedGame);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update game' });
  }
};

// @desc    Delete a game
// @route   DELETE /api/games/:id
const deleteGame = async (req, res) => {
  try {
    const game = await Game.findByIdAndDelete(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const io = getIO();
    if (io) {
      io.emit('game_deleted', { id: req.params.id });
    }

    res.json({ message: 'Game deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete game' });
  }
};

module.exports = {
  getGames,
  createGame,
  updateGame,
  deleteGame,
};