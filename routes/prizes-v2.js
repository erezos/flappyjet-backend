/**
 * Prizes V2 API Routes
 * Device-based prize polling and claiming (no authentication required)
 * 
 * GET /api/v2/prizes/pending - Poll for unclaimed prizes
 * POST /api/v2/prizes/claim - Mark prize as claimed
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * GET /api/v2/prizes/pending
 * Get unclaimed prizes for user (poll-based system)
 * 
 * Query params:
 * - user_id (required): Device ID
 * 
 * Response includes tournament names and prize details for display!
 */
router.get('/pending', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id required'
      });
    }

    const db = req.app.locals.db;

    logger.debug('📥 Checking pending prizes', { user_id });

    // Query unclaimed prizes
    const result = await db.query(`
      SELECT 
        prize_id,
        tournament_id,
        tournament_name,
        rank,
        coins,
        gems,
        awarded_at,
        created_at
      FROM prizes
      WHERE user_id = $1
        AND claimed_at IS NULL
      ORDER BY awarded_at DESC
    `, [user_id]);

    const prizes = result.rows.map(prize => ({
      prize_id: prize.prize_id,
      tournament_id: prize.tournament_id,
      tournament_name: prize.tournament_name,
      rank: prize.rank,
      rank_label: getRankLabel(prize.rank),
      coins: prize.coins,
      gems: prize.gems,
      awarded_at: prize.awarded_at,
      total_value: prize.coins + (prize.gems * 10), // Display total value (gems worth 10x coins)
      celebration_message: getCelebrationMessage(prize.rank, prize.coins, prize.gems)
    }));

    logger.info('✅ Pending prizes checked', { 
      user_id, 
      count: prizes.length,
      total_coins: prizes.reduce((sum, p) => sum + p.coins, 0),
      total_gems: prizes.reduce((sum, p) => sum + p.gems, 0)
    });

    res.json({
      success: true,
      prizes,
      count: prizes.length,
      has_prizes: prizes.length > 0
    });

  } catch (error) {
    logger.error('❌ Error getting pending prizes', { error: error.message, user_id: req.query.user_id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/v2/prizes/claim
 * Mark prize as claimed (fire-and-forget from client)
 * 
 * Body: { prize_id, user_id, claimed_at }
 * 
 * Client claims locally first, then notifies backend asynchronously
 */
router.post('/claim', async (req, res) => {
  try {
    const { prize_id, user_id, claimed_at } = req.body;

    if (!prize_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'prize_id and user_id required'
      });
    }

    logger.debug('📥 Prize claim request', { prize_id, user_id });

    // ✅ Return 200 immediately (fire-and-forget)
    // Client has already awarded the prize locally
    res.json({
      success: true,
      message: 'Prize claim acknowledged',
      prize_id
    });

    // 🔥 Update database asynchronously (don't await)
    const db = req.app.locals.db;
    
    db.query(`
      UPDATE prizes
      SET claimed_at = $1,
          notified_at = NOW()
      WHERE prize_id = $2 AND user_id = $3
    `, [claimed_at || new Date().toISOString(), prize_id, user_id])
    .then(() => {
      logger.info('✅ Prize marked as claimed', { prize_id, user_id });
    })
    .catch(error => {
      logger.error('❌ Error marking prize as claimed', { 
        error: error.message, 
        prize_id, 
        user_id 
      });
    });

  } catch (error) {
    logger.error('❌ Error processing prize claim', { error: error.message });
    
    // Even on error, return 200 (fire-and-forget)
    res.status(200).json({
      success: true,
      message: 'Prize claim acknowledged',
      note: 'Processing may have encountered issues'
    });
  }
});

/**
 * GET /api/v2/prizes/history
 * Get prize claim history for user
 * 
 * Query params:
 * - user_id (required): Device ID
 * - limit (optional, default: 10): Number of prizes to return
 */
router.get('/history', async (req, res) => {
  try {
    const { user_id, limit = 10 } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id required'
      });
    }

    const db = req.app.locals.db;

    logger.debug('📥 Prize history requested', { user_id, limit });

    const result = await db.query(`
      SELECT 
        prize_id,
        tournament_id,
        tournament_name,
        rank,
        coins,
        gems,
        awarded_at,
        claimed_at
      FROM prizes
      WHERE user_id = $1
      ORDER BY awarded_at DESC
      LIMIT $2
    `, [user_id, parseInt(limit)]);

    const prizes = result.rows.map(prize => ({
      prize_id: prize.prize_id,
      tournament_id: prize.tournament_id,
      tournament_name: prize.tournament_name,
      rank: prize.rank,
      rank_label: getRankLabel(prize.rank),
      coins: prize.coins,
      gems: prize.gems,
      awarded_at: prize.awarded_at,
      claimed_at: prize.claimed_at,
      claimed: prize.claimed_at !== null
    }));

    res.json({
      success: true,
      prizes,
      count: prizes.length
    });

  } catch (error) {
    logger.error('❌ Error getting prize history', { error: error.message, user_id: req.query.user_id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v2/prizes/stats
 * Get prize statistics for user
 * 
 * Query params:
 * - user_id (required): Device ID
 */
router.get('/stats', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id required'
      });
    }

    const db = req.app.locals.db;

    logger.debug('📥 Prize stats requested', { user_id });

    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_prizes,
        COUNT(*) FILTER (WHERE claimed_at IS NOT NULL) as claimed_prizes,
        COUNT(*) FILTER (WHERE claimed_at IS NULL) as pending_prizes,
        SUM(coins) as total_coins,
        SUM(gems) as total_gems,
        SUM(coins) FILTER (WHERE claimed_at IS NOT NULL) as claimed_coins,
        SUM(gems) FILTER (WHERE claimed_at IS NOT NULL) as claimed_gems,
        MIN(rank) as best_rank,
        COUNT(DISTINCT tournament_id) as tournaments_won
      FROM prizes
      WHERE user_id = $1
    `, [user_id]);

    const data = stats.rows[0];

    res.json({
      success: true,
      stats: {
        total_prizes: parseInt(data.total_prizes) || 0,
        claimed_prizes: parseInt(data.claimed_prizes) || 0,
        pending_prizes: parseInt(data.pending_prizes) || 0,
        total_coins_won: parseInt(data.total_coins) || 0,
        total_gems_won: parseInt(data.total_gems) || 0,
        claimed_coins: parseInt(data.claimed_coins) || 0,
        claimed_gems: parseInt(data.claimed_gems) || 0,
        best_rank: data.best_rank ? parseInt(data.best_rank) : null,
        tournaments_won: parseInt(data.tournaments_won) || 0
      }
    });

  } catch (error) {
    logger.error('❌ Error getting prize stats', { error: error.message, user_id: req.query.user_id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Helper: Get rank label for display
 * @param {number} rank - Player's rank
 * @returns {string} - Display label
 */
function getRankLabel(rank) {
  if (rank === 1) return '🥇 1st Place';
  if (rank === 2) return '🥈 2nd Place';
  if (rank === 3) return '🥉 3rd Place';
  if (rank <= 10) return `🏆 ${rank}th Place`;
  if (rank <= 50) return `🎖️ ${rank}th Place`;
  return `${rank}th Place`;
}

/**
 * Helper: Get celebration message
 * @param {number} rank - Player's rank
 * @param {number} coins - Coins won
 * @param {number} gems - Gems won
 * @returns {string} - Celebration message
 */
function getCelebrationMessage(rank, coins, gems) {
  if (rank === 1) {
    return `🎉 CHAMPION! You dominated the tournament!`;
  }
  if (rank === 2) {
    return `🌟 AMAZING! Second place finish!`;
  }
  if (rank === 3) {
    return `🔥 EXCELLENT! You made it to the podium!`;
  }
  if (rank <= 10) {
    return `💪 GREAT JOB! Top 10 finish!`;
  }
  if (rank <= 50) {
    return `👏 WELL DONE! You earned a prize!`;
  }
  return `🎁 Congratulations on your prize!`;
}

module.exports = router;

