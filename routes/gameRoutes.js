// backend/routes/gameRoutes.js
const express = require('express');
const router = express.Router();
const {
  getGames,
  createGame,
  updateGame,
  deleteGame,
} = require('../controllers/gameController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getGames)
  .post(protect, createGame);

router.route('/:id')
  .put(protect, updateGame)
  .delete(protect, deleteGame);

module.exports = router;