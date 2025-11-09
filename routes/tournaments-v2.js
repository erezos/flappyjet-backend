/**
 * Tournaments V2 API Routes
 * Device-based tournaments (no authentication required)
 * 
 * GET /api/v2/tournaments/current - Get current tournament info
 * GET /api/v2/tournaments/:id/leaderboard - Get tournament top 15
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * GET /api/v2/tournaments/current
 * Get current tournament info (no auth required)
 */
router.get('/current', async (req, res) => {
  try {
    const tournamentManager = req.app.locals.tournamentManager;

    if (!tournamentManager) {
      return res.status(503).json({
        success: false,
        error: 'Tournament service unavailable'
      });
    }

    logger.debug('📥 Current tournament requested');

    const result = await tournamentManager.getCurrentTournament();

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      tournament: result.tournament,
      message: result.message
    });

  } catch (error) {
    logger.error('❌ Error getting current tournament', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v2/tournaments/:id/leaderboard
 * Get tournament top 15 leaderboard (no auth required, cached)
 * 
 * Query params:
 * - user_id (optional): If provided, also return user's rank
 * 
 * Response includes nicknames for display!
 */
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    const cache = req.app.locals.cacheManager;
    const db = req.app.locals.db;

    logger.debug('📥 Tournament leaderboard requested', { tournament_id: id, user_id });

    // 1. Try cache first (2 min TTL - tournaments update more frequently)
    let leaderboard = null;
    const cacheKey = `tournament:${id}:leaderboard:top15`;
    
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        leaderboard = JSON.parse(cached);
        logger.debug('✅ Cache hit for tournament leaderboard');
      }
    } catch (cacheError) {
      logger.warn('⚠️ Cache error, falling back to database', { error: cacheError.message });
    }

    // 2. Cache miss - query database
    if (!leaderboard) {
      const result = await db.query(`
        SELECT 
          user_id,
          nickname,
          best_score,
          total_attempts,
          last_attempt_at,
          ROW_NUMBER() OVER (ORDER BY best_score DESC, last_attempt_at DESC) as rank
        FROM tournament_leaderboard
        WHERE tournament_id = $1
        ORDER BY best_score DESC, last_attempt_at DESC
        LIMIT 15
      `, [id]);

      leaderboard = result.rows;
      
      // Cache for 4 minutes (matches cron frequency)
      try {
        await cache.set(cacheKey, JSON.stringify(leaderboard), 240);
      } catch (cacheError) {
        logger.warn('⚠️ Failed to cache tournament leaderboard', { error: cacheError.message });
      }
    }

    // 3. If user_id provided, get user's rank
    let userRank = null;
    if (user_id) {
      try {
        const rankResult = await db.query(`
          SELECT 
            rank,
            nickname,
            best_score,
            total_attempts,
            last_attempt_at
          FROM (
            SELECT 
              user_id,
              nickname,
              best_score,
              total_attempts,
              last_attempt_at,
              ROW_NUMBER() OVER (ORDER BY best_score DESC, last_attempt_at DESC) as rank
            FROM tournament_leaderboard
            WHERE tournament_id = $1
          ) ranked
          WHERE user_id = $2
        `, [id, user_id]);

        if (rankResult.rows.length > 0) {
          const data = rankResult.rows[0];
          userRank = {
            rank: parseInt(data.rank),
            nickname: data.nickname || 'Pilot',
            best_score: data.best_score,
            total_attempts: data.total_attempts,
            last_attempt: data.last_attempt_at,
            in_top_15: parseInt(data.rank) <= 15,
            // Determine prize tier
            prize_tier: getPrizeTier(parseInt(data.rank))
          };
        } else {
          // User hasn't participated yet
          userRank = {
            rank: null,
            participated: false,
            message: 'Play a game to enter the tournament!'
          };
        }
      } catch (error) {
        logger.error('❌ Error getting user tournament rank', { error: error.message, user_id, tournament_id: id });
      }
    }

    // 4. Get total participants
    const totalResult = await db.query(
      'SELECT COUNT(*) as count FROM tournament_leaderboard WHERE tournament_id = $1',
      [id]
    );
    const totalParticipants = parseInt(totalResult.rows[0].count);

    res.json({
      success: true,
      tournament_id: id,
      leaderboard: leaderboard.map(entry => ({
        rank: parseInt(entry.rank),
        user_id: entry.user_id,
        nickname: entry.nickname || 'Pilot', // Default nickname if not set
        best_score: entry.best_score,
        total_attempts: entry.total_attempts,
        last_attempt: entry.last_attempt_at,
        prize_tier: getPrizeTier(parseInt(entry.rank))
      })),
      user_rank: userRank,
      total_participants: totalParticipants,
      last_updated: new Date().toISOString(),
      cache_ttl_seconds: 240
    });

  } catch (error) {
    logger.error('❌ Error getting tournament leaderboard', { error: error.message, tournament_id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v2/tournaments/:id/prizes
 * Get prize pool information for a tournament
 */
router.get('/:id/prizes', async (req, res) => {
  try {
    const { id } = req.params;

    logger.debug('📥 Tournament prizes requested', { tournament_id: id });

    // Prize pool from BACKEND_API_SPECIFICATION.md
    const prizePool = {
      tournament_id: id,
      prizes: [
        { rank: 1, coins: 5000, gems: 250, label: '1st Place' },
        { rank: 2, coins: 3000, gems: 150, label: '2nd Place' },
        { rank: 3, coins: 2000, gems: 100, label: '3rd Place' },
        { ranks: [4, 5, 6, 7, 8, 9, 10], coins: 1000, gems: 50, label: '4th-10th Place' },
        { ranks: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50], coins: 500, gems: 25, label: '11th-50th Place' }
      ]
    };

    res.json({
      success: true,
      ...prizePool
    });

  } catch (error) {
    logger.error('❌ Error getting tournament prizes', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Helper function to determine prize tier based on rank
 * @param {number} rank - Player's rank
 * @returns {string} - Prize tier description
 */
function getPrizeTier(rank) {
  if (rank === 1) return '🥇 1st: 5000 coins + 250 gems';
  if (rank === 2) return '🥈 2nd: 3000 coins + 150 gems';
  if (rank === 3) return '🥉 3rd: 2000 coins + 100 gems';
  if (rank >= 4 && rank <= 10) return '🏆 4th-10th: 1000 coins + 50 gems';
  if (rank >= 11 && rank <= 50) return '🎖️ 11th-50th: 500 coins + 25 gems';
  return 'No prize';
}

module.exports = router;

