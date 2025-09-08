/// 👤 Player Routes - Profile management and player data
const express = require('express');
const Joi = require('joi');

module.exports = (db) => {
  const router = express.Router();
  
  // Import auth middleware
  const authRoutes = require('./auth')(db);
const logger = require('../utils/logger');
  const authenticateToken = authRoutes.authenticateToken;

  // Validation schemas
  const updateProfileSchema = Joi.object({
    nickname: Joi.string().min(1).max(50).optional(),
    countryCode: Joi.string().length(2).optional(),
    timezone: Joi.string().max(50).optional()
  });

  /// 👤 Get full player profile
  router.get('/profile', authenticateToken, async (req, res) => {
    try {
      const playerProfile = await db.query(`
        SELECT 
          p.id, p.nickname, p.best_score, p.best_streak, p.total_games_played,
          p.current_coins, p.current_gems, p.current_hearts, p.is_premium,
          p.heart_booster_expiry, p.created_at, p.last_active_at, p.platform,
          p.country_code, p.timezone,
          COUNT(DISTINCT s.id) as total_scores,
          COUNT(DISTINCT pa.id) as achievements_unlocked,
          COUNT(DISTINCT pm.id) FILTER (WHERE pm.completed = true) as missions_completed
        FROM players p
        LEFT JOIN scores s ON p.id = s.player_id
        LEFT JOIN player_achievements pa ON p.id = pa.player_id AND pa.completed = true
        LEFT JOIN player_missions pm ON p.id = pm.player_id AND pm.completed = true
        WHERE p.id = $1
        GROUP BY p.id
      `, [req.playerId]);

      if (playerProfile.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const profile = playerProfile.rows[0];

      // Get player inventory
      const inventory = await db.query(`
        SELECT item_type, item_id, quantity, equipped, acquired_at, acquired_method
        FROM player_inventory
        WHERE player_id = $1
        ORDER BY acquired_at DESC
      `, [req.playerId]);

      // Get recent achievements
      const recentAchievements = await db.query(`
        SELECT a.id, a.title, a.description, a.rarity, pa.completed_at
        FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.player_id = $1 AND pa.completed = true
        ORDER BY pa.completed_at DESC
        LIMIT 5
      `, [req.playerId]);

      res.json({
        success: true,
        profile: {
          ...profile,
          heartBoosterActive: profile.heart_booster_expiry && 
                            new Date(profile.heart_booster_expiry) > new Date(),
          inventory: inventory.rows,
          recentAchievements: recentAchievements.rows
        }
      });

    } catch (error) {
      logger.error('Profile fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  /// ✏️ Update player profile
  router.put('/profile', authenticateToken, async (req, res) => {
    try {
      const { error, value } = updateProfileSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { nickname, countryCode, timezone } = value;
      const updates = [];
      const values = [req.playerId];
      let paramCount = 1;

      if (nickname) {
        updates.push(`nickname = $${++paramCount}`);
        values.push(nickname);
      }

      if (countryCode) {
        updates.push(`country_code = $${++paramCount}`);
        values.push(countryCode);
      }

      if (timezone) {
        updates.push(`timezone = $${++paramCount}`);
        values.push(timezone);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      updates.push(`updated_at = NOW()`);

      const updateQuery = `
        UPDATE players 
        SET ${updates.join(', ')}
        WHERE id = $1
        RETURNING id, nickname, country_code, timezone, updated_at
      `;

      const result = await db.query(updateQuery, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      res.json({
        success: true,
        player: result.rows[0],
        message: 'Profile updated successfully'
      });

    } catch (error) {
      logger.error('Profile update error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  /// 📊 Get player statistics
  router.get('/stats', authenticateToken, async (req, res) => {
    try {
      const stats = await db.query(`
        SELECT 
          p.best_score,
          p.best_streak,
          p.total_games_played,
          p.total_coins_earned,
          p.total_gems_earned,
          COUNT(DISTINCT s.id) as total_scores_submitted,
          AVG(s.score) as average_score,
          MAX(s.survival_time) as longest_survival_time,
          COUNT(DISTINCT pa.id) FILTER (WHERE pa.completed = true) as achievements_count,
          COUNT(DISTINCT pm.id) FILTER (WHERE pm.completed = true) as missions_completed_count,
          (
            SELECT COUNT(*) 
            FROM scores s2 
            JOIN players p2 ON s2.player_id = p2.id 
            WHERE s2.score < p.best_score AND p2.is_banned = false
          ) + 1 as global_rank
        FROM players p
        LEFT JOIN scores s ON p.id = s.player_id
        LEFT JOIN player_achievements pa ON p.id = pa.player_id
        LEFT JOIN player_missions pm ON p.id = pm.player_id
        WHERE p.id = $1
        GROUP BY p.id, p.best_score
      `, [req.playerId]);

      if (stats.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const playerStats = stats.rows[0];

      // Get play streak (consecutive days played)
      const playStreak = await db.query(`
        SELECT COUNT(DISTINCT DATE(created_at)) as play_streak
        FROM scores
        WHERE player_id = $1 
          AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      `, [req.playerId]);

      res.json({
        success: true,
        stats: {
          ...playerStats,
          average_score: playerStats.average_score ? Math.round(playerStats.average_score) : 0,
          play_streak: playStreak.rows[0].play_streak || 0
        }
      });

    } catch (error) {
      logger.error('Stats fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  });

  /// 🔄 Sync player data
  router.post('/sync', authenticateToken, async (req, res) => {
    try {
      // Get complete player data for sync
      const playerData = await db.query(`
        SELECT 
          id, nickname, best_score, best_streak, total_games_played,
          current_coins, current_gems, current_hearts, is_premium,
          heart_booster_expiry, created_at, last_active_at, platform
        FROM players
        WHERE id = $1
      `, [req.playerId]);

      if (playerData.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      // Update last sync time
      await db.query(`
        UPDATE players 
        SET last_active_at = NOW()
        WHERE id = $1
      `, [req.playerId]);

      res.json({
        success: true,
        player: playerData.rows[0],
        syncTime: new Date().toISOString(),
        message: 'Player data synced successfully'
      });

    } catch (error) {
      logger.error('Sync error:', error);
      res.status(500).json({ error: 'Failed to sync player data' });
    }
  });

  return router;
};
