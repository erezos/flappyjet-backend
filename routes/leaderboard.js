/**
 * Global Leaderboard API Routes
 * Handles all-time player rankings and scores
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { v4: uuidv4, validate: isValidUUID } = require('uuid');
const router = express.Router();

// Middleware
const { authenticateToken } = require('../middleware/auth');
const { rateLimitMiddleware } = require('../middleware/rate-limit');

/**
 * Get global leaderboard (all-time high scores)
 * GET /api/leaderboard/global
 */
router.get('/global',
  rateLimitMiddleware('global_leaderboard', 60, 120), // 120 requests per minute
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('playerId').optional().isUUID().withMessage('Invalid player ID')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const limit = parseInt(req.query.limit) || 15;
      const offset = parseInt(req.query.offset) || 0;
      const requestingPlayerId = req.query.playerId;

      const leaderboardManager = req.app.locals.leaderboardManager;
      const result = await leaderboardManager.getGlobalLeaderboard({
        limit,
        offset,
        requestingPlayerId
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        leaderboard: result.leaderboard,
        userPosition: result.userPosition,
        pagination: {
          limit,
          offset,
          hasMore: result.leaderboard.length === limit
        }
      });

    } catch (error) {
      console.error('Error getting global leaderboard:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get global leaderboard'
      });
    }
  }
);

/**
 * Get player's personal scores (top 10)
 * GET /api/leaderboard/player/:playerId/scores
 */
router.get('/player/:playerId/scores',
  authenticateToken,
  rateLimitMiddleware('player_scores', 60, 60), // 60 requests per minute
  [
    param('playerId').isUUID().withMessage('Invalid player ID'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { playerId } = req.params;
      const limit = parseInt(req.query.limit) || 10;
      
      // Players can only view their own scores unless they're admin
      if (req.user.playerId !== playerId && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const leaderboardManager = req.app.locals.leaderboardManager;
      const result = await leaderboardManager.getPlayerPersonalScores(playerId, limit);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        scores: result.scores
      });

    } catch (error) {
      console.error('Error getting player personal scores:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get personal scores'
      });
    }
  }
);

/**
 * Submit a game score
 * POST /api/leaderboard/submit
 */
router.post('/submit',
  authenticateToken,
  rateLimitMiddleware('score_submission', 60, 50), // 50 scores per minute
  [
    body('score').isInt({ min: 0 }).withMessage('Score must be a non-negative integer'),
    body('gameData').optional().isObject().withMessage('Game data must be an object'),
    body('jetSkin').optional().isString().withMessage('Jet skin must be a string'),
    body('theme').optional().isString().withMessage('Theme must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { score, gameData = {}, jetSkin, theme } = req.body;
      const playerId = req.user.playerId;
      const playerName = req.user.playerName || 'Anonymous';

      const leaderboardManager = req.app.locals.leaderboardManager;
      const result = await leaderboardManager.submitScore({
        playerId,
        playerName,
        score,
        gameData,
        jetSkin,
        theme
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        newBest: result.newBest,
        globalRank: result.globalRank,
        score: result.score
      });

    } catch (error) {
      console.error('Error submitting score:', error);
      res.status(500).json({
        success: false,
        error: 'Score submission failed'
      });
    }
  }
);

module.exports = router;
