/**
 * Tournament API Routes
 * Handles weekly competitions with prizes
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { v4: uuidv4, validate: isValidUUID } = require('uuid');
const router = express.Router();

// Middleware
const { authenticateToken } = require('../middleware/auth');
const { rateLimitMiddleware } = require('../middleware/rate-limit');

/**
 * Get current active tournament
 * GET /api/tournaments/current
 */
router.get('/current', 
  rateLimitMiddleware('tournaments', 60, 100), // 100 requests per minute
  async (req, res) => {
    try {
      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.getCurrentTournament();

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        tournament: result.tournament,
        message: result.message
      });

    } catch (error) {
      console.error('Error getting current tournament:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * Register for tournament
 * POST /api/tournaments/:tournamentId/register
 */
router.post('/:tournamentId/register',
  authenticateToken,
  rateLimitMiddleware('tournament_register', 300, 5), // 5 registrations per 5 minutes
  [
    param('tournamentId').isUUID().withMessage('Invalid tournament ID'),
    body('playerName').isLength({ min: 1, max: 50 }).withMessage('Player name must be 1-50 characters')
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

      const { tournamentId } = req.params;
      const { playerName } = req.body;
      const playerId = req.user.playerId; // From auth token

      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.registerPlayer(tournamentId, {
        playerId,
        playerName
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.status(201).json({
        success: true,
        participantId: result.participantId,
        message: result.message
      });

    } catch (error) {
      console.error('Error registering for tournament:', error);
      res.status(500).json({
        success: false,
        error: 'Registration failed'
      });
    }
  }
);

/**
 * Submit tournament score
 * POST /api/tournaments/:tournamentId/scores
 */
router.post('/:tournamentId/scores',
  authenticateToken,
  rateLimitMiddleware('tournament_score', 60, 30), // 30 scores per minute
  [
    param('tournamentId').isUUID().withMessage('Invalid tournament ID'),
    body('score').isInt({ min: 0 }).withMessage('Score must be a non-negative integer'),
    body('gameData').optional().isObject().withMessage('Game data must be an object')
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

      const { tournamentId } = req.params;
      const { score, gameData } = req.body;
      const playerId = req.user.playerId;

      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.submitScore(tournamentId, {
        playerId,
        score,
        gameData
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
        score: result.score,
        previousBest: result.previousBest,
        rank: result.rank,
        totalGames: result.totalGames
      });

    } catch (error) {
      console.error('Error submitting tournament score:', error);
      res.status(500).json({
        success: false,
        error: 'Score submission failed'
      });
    }
  }
);

/**
 * Get tournament leaderboard
 * GET /api/tournaments/:tournamentId/leaderboard
 */
router.get('/:tournamentId/leaderboard',
  rateLimitMiddleware('tournament_leaderboard', 60, 120), // 120 requests per minute
  [
    param('tournamentId').isUUID().withMessage('Invalid tournament ID'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
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

      const { tournamentId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.getTournamentLeaderboard(tournamentId, {
        limit,
        offset
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
        pagination: {
          limit,
          offset,
          hasMore: result.leaderboard.length === limit
        }
      });

    } catch (error) {
      console.error('Error getting tournament leaderboard:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get leaderboard'
      });
    }
  }
);

/**
 * Get player tournament stats
 * GET /api/tournaments/player/:playerId/stats
 */
router.get('/player/:playerId/stats',
  authenticateToken,
  rateLimitMiddleware('player_tournament_stats', 60, 60), // 60 requests per minute
  [
    param('playerId').isUUID().withMessage('Invalid player ID')
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
      
      // Players can only view their own stats unless they're admin
      if (req.user.playerId !== playerId && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.getPlayerStats(playerId);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        stats: result.stats
      });

    } catch (error) {
      console.error('Error getting player tournament stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get player stats'
      });
    }
  }
);

/**
 * Get player prize history
 * GET /api/tournaments/player/:playerId/prizes
 */
router.get('/player/:playerId/prizes',
  authenticateToken,
  rateLimitMiddleware('player_prizes', 60, 30), // 30 requests per minute
  [
    param('playerId').isUUID().withMessage('Invalid player ID'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100')
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
      const limit = parseInt(req.query.limit) || 50;
      
      // Players can only view their own prize history unless they're admin
      if (req.user.playerId !== playerId && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const prizeManager = req.app.locals.prizeManager;
      const result = await prizeManager.getPlayerPrizeHistory(playerId, limit);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        prizeHistory: result.prizeHistory
      });

    } catch (error) {
      console.error('Error getting player prize history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get prize history'
      });
    }
  }
);

// Admin-only routes

/**
 * Create weekly tournament (Admin only)
 * POST /api/tournaments/create-weekly
 */
router.post('/create-weekly',
  authenticateToken,
  rateLimitMiddleware('admin_create_tournament', 3600, 10), // 10 per hour
  [
    body('name').optional().isLength({ min: 1, max: 255 }).withMessage('Name must be 1-255 characters'),
    body('prizePool').optional().isInt({ min: 0 }).withMessage('Prize pool must be non-negative'),
    body('startOffsetHours').optional().isInt({ min: 0, max: 168 }).withMessage('Start offset must be 0-168 hours')
  ],
  async (req, res) => {
    try {
      // Check admin permissions
      if (!req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { name, prizePool, startOffsetHours } = req.body;

      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.createWeeklyTournament({
        name,
        prizePool,
        startOffsetHours
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.status(201).json({
        success: true,
        tournament: result.tournament
      });

    } catch (error) {
      console.error('Error creating weekly tournament:', error);
      res.status(500).json({
        success: false,
        error: 'Tournament creation failed'
      });
    }
  }
);

/**
 * Start tournament (Admin only)
 * POST /api/tournaments/:tournamentId/start
 */
router.post('/:tournamentId/start',
  authenticateToken,
  rateLimitMiddleware('admin_start_tournament', 3600, 20), // 20 per hour
  [
    param('tournamentId').isUUID().withMessage('Invalid tournament ID')
  ],
  async (req, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { tournamentId } = req.params;

      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.startTournament(tournamentId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        message: result.message,
        participantCount: result.participantCount
      });

    } catch (error) {
      console.error('Error starting tournament:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start tournament'
      });
    }
  }
);

/**
 * End tournament (Admin only)
 * POST /api/tournaments/:tournamentId/end
 */
router.post('/:tournamentId/end',
  authenticateToken,
  rateLimitMiddleware('admin_end_tournament', 3600, 20), // 20 per hour
  [
    param('tournamentId').isUUID().withMessage('Invalid tournament ID')
  ],
  async (req, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { tournamentId } = req.params;

      const tournamentManager = req.app.locals.tournamentManager;
      const result = await tournamentManager.endTournament(tournamentId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        finalLeaderboard: result.finalLeaderboard,
        prizeDistributions: result.prizeDistributions,
        totalPrizesDistributed: result.totalPrizesDistributed,
        message: result.message
      });

    } catch (error) {
      console.error('Error ending tournament:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to end tournament'
      });
    }
  }
);

/**
 * Get tournament prize statistics (Admin only)
 * GET /api/tournaments/:tournamentId/prize-stats
 */
router.get('/:tournamentId/prize-stats',
  authenticateToken,
  rateLimitMiddleware('admin_prize_stats', 60, 30), // 30 per minute
  [
    param('tournamentId').isUUID().withMessage('Invalid tournament ID')
  ],
  async (req, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { tournamentId } = req.params;

      const prizeManager = req.app.locals.prizeManager;
      const result = await prizeManager.getTournamentPrizeStats(tournamentId);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        stats: result.stats
      });

    } catch (error) {
      console.error('Error getting tournament prize stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get prize stats'
      });
    }
  }
);

module.exports = router;
