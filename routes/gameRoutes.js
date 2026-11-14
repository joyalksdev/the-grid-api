// backend/routes/gameRoutes.js
const express = require('express');
const router = express.Router();
const {
  getGames,
  getGameOptions,
  createGame,
  updateGame,
  deleteGame,
} = require('../controllers/gameController');
const { protect } = require('../middleware/authMiddleware');
const gameImageUpload = require('../middleware/gameImageUpload');

router.get('/options', protect, getGameOptions);

router.route('/')
  .get(protect, getGames)
  .post(protect, gameImageUpload, createGame);

router.route('/:id')
  .put(protect, gameImageUpload, updateGame)
  .delete(protect, deleteGame);

module.exports = router;
