/**
 * Leaderboards V2 API Routes
 * Device-based leaderboards (no authentication required)
 * 
 * GET /api/v2/leaderboard/global - Get top 15 global players
 * GET /api/v2/leaderboard/user/:userId - Get user's rank
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * GET /api/v2/leaderboard/global
 * Get global top 15 players (no auth required, cached)
 * 
 * Query params:
 * - user_id (optional): If provided, also return user's rank
 * 
 * Response includes nicknames for display!
 */
router.get('/global', async (req, res) => {
  try {
    const { user_id } = req.query;
    const cache = req.app.locals.cacheManager;
    const db = req.app.locals.db;

    logger.debug('📥 Global leaderboard requested', { user_id });

    // 1. Try cache first (5 min TTL)
    let leaderboard = null;
    const cacheKey = 'leaderboard:global:top15';
    
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        leaderboard = JSON.parse(cached);
        logger.debug('✅ Cache hit for global leaderboard');
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
          high_score,
          total_games,
          last_played_at,
          ROW_NUMBER() OVER (ORDER BY high_score DESC, last_played_at DESC) as rank
        FROM leaderboard_global
        ORDER BY high_score DESC, last_played_at DESC
        LIMIT 15
      `);

      leaderboard = result.rows;
      
      // Cache for 10 minutes (matches cron frequency)
      try {
        await cache.set(cacheKey, JSON.stringify(leaderboard), 600);
      } catch (cacheError) {
        logger.warn('⚠️ Failed to cache leaderboard', { error: cacheError.message });
      }
    }

    // 3. If user_id provided, get user's rank
    let userRank = null;
    if (user_id) {
      try {
        const rankResult = await db.query(`
          SELECT 
            rank,
            high_score,
            total_games,
            nickname
          FROM (
            SELECT 
              user_id,
              nickname,
              high_score,
              total_games,
              ROW_NUMBER() OVER (ORDER BY high_score DESC, last_played_at DESC) as rank
            FROM leaderboard_global
          ) ranked
          WHERE user_id = $1
        `, [user_id]);

        if (rankResult.rows.length > 0) {
          userRank = {
            rank: parseInt(rankResult.rows[0].rank),
            nickname: rankResult.rows[0].nickname,
            high_score: rankResult.rows[0].high_score,
            total_games: rankResult.rows[0].total_games,
            in_top_15: parseInt(rankResult.rows[0].rank) <= 15
          };
        }
      } catch (error) {
        logger.error('❌ Error getting user rank', { error: error.message, user_id });
      }
    }

    // 4. Get total player count
    const totalResult = await db.query('SELECT COUNT(*) as count FROM leaderboard_global');
    const totalPlayers = parseInt(totalResult.rows[0].count);

    res.json({
      success: true,
      leaderboard: leaderboard.map(entry => ({
        rank: parseInt(entry.rank),
        user_id: entry.user_id,
        nickname: entry.nickname || 'Pilot', // Default nickname if not set
        high_score: entry.high_score,
        total_games: entry.total_games,
        last_played: entry.last_played_at
      })),
      user_rank: userRank,
      total_players: totalPlayers,
      last_updated: new Date().toISOString(),
      cache_ttl_seconds: 600
    });

  } catch (error) {
    logger.error('❌ Error getting global leaderboard', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v2/leaderboard/user/:userId
 * Get user's rank and stats
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = req.app.locals.db;

    logger.debug('📥 User rank requested', { userId });

    // Get user's rank and stats
    const result = await db.query(`
      SELECT 
        rank,
        nickname,
        high_score,
        total_games,
        total_playtime_seconds,
        last_played_at
      FROM (
        SELECT 
          user_id,
          nickname,
          high_score,
          total_games,
          total_playtime_seconds,
          last_played_at,
          ROW_NUMBER() OVER (ORDER BY high_score DESC, last_played_at DESC) as rank
        FROM leaderboard_global
      ) ranked
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        found: false,
        message: 'User not in leaderboard yet'
      });
    }

    const userData = result.rows[0];

    // Get total players for percentage calculation
    const totalResult = await db.query('SELECT COUNT(*) as count FROM leaderboard_global');
    const totalPlayers = parseInt(totalResult.rows[0].count);

    res.json({
      success: true,
      found: true,
      user: {
        user_id: userId,
        nickname: userData.nickname || 'Pilot',
        rank: parseInt(userData.rank),
        high_score: userData.high_score,
        total_games: userData.total_games,
        total_playtime_hours: (userData.total_playtime_seconds / 3600).toFixed(1),
        last_played: userData.last_played_at,
        percentile: ((1 - (userData.rank - 1) / totalPlayers) * 100).toFixed(1)
      },
      total_players: totalPlayers
    });

  } catch (error) {
    logger.error('❌ Error getting user rank', { error: error.message, userId: req.params.userId });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/v2/leaderboard/update-nickname
 * Update user's nickname (for display in leaderboards)
 * 
 * Body: { user_id, nickname }
 */
router.post('/update-nickname', async (req, res) => {
  try {
    const { user_id, nickname } = req.body;

    if (!user_id || !nickname) {
      return res.status(400).json({
        success: false,
        error: 'user_id and nickname required'
      });
    }

    // Validate nickname (3-20 chars, alphanumeric + spaces)
    if (nickname.length < 3 || nickname.length > 20) {
      return res.status(400).json({
        success: false,
        error: 'Nickname must be 3-20 characters'
      });
    }

    if (!/^[a-zA-Z0-9\s]+$/.test(nickname)) {
      return res.status(400).json({
        success: false,
        error: 'Nickname can only contain letters, numbers, and spaces'
      });
    }

    const db = req.app.locals.db;

    // Update nickname in leaderboard
    await db.query(`
      UPDATE leaderboard_global
      SET nickname = $1, updated_at = NOW()
      WHERE user_id = $2
    `, [nickname.trim(), user_id]);

    // Also update in tournament leaderboard
    await db.query(`
      UPDATE tournament_leaderboard
      SET nickname = $1
      WHERE user_id = $2
    `, [nickname.trim(), user_id]);

    // Clear cache to reflect new nickname
    const cache = req.app.locals.cacheManager;
    try {
      await cache.delete('leaderboard:global:top15');
    } catch (error) {
      logger.warn('⚠️ Failed to clear cache', { error: error.message });
    }

    logger.info('✅ Nickname updated', { user_id, nickname });

    res.json({
      success: true,
      message: 'Nickname updated successfully',
      nickname: nickname.trim()
    });

  } catch (error) {
    logger.error('❌ Error updating nickname', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;

