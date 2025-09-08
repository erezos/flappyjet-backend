/// 🏅 Achievements Routes - Achievement system management
const express = require('express');
const Joi = require('joi');

module.exports = (db) => {
  const router = express.Router();
  
  // Import auth middleware
  const authRoutes = require('./auth')(db);
const logger = require('../utils/logger');
  const authenticateToken = authRoutes.authenticateToken;

  /// 🏅 Get all achievements
  router.get('/', async (req, res) => {
    try {
      const achievements = await db.query(`
        SELECT 
          id, category, rarity, title, description, icon_url,
          target, reward_coins, reward_gems, is_secret, is_active
        FROM achievements
        WHERE is_active = true
        ORDER BY 
          CASE rarity 
            WHEN 'common' THEN 1
            WHEN 'rare' THEN 2
            WHEN 'epic' THEN 3
            WHEN 'legendary' THEN 4
          END,
          target ASC
      `);

      res.json({
        success: true,
        achievements: achievements.rows
      });

    } catch (error) {
      logger.error('Achievements fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch achievements' });
    }
  });

  /// 👤 Get player achievements
  router.get('/player', authenticateToken, async (req, res) => {
    try {
      const playerAchievements = await db.query(`
        SELECT 
          a.id, a.category, a.rarity, a.title, a.description, a.icon_url,
          a.target, a.reward_coins, a.reward_gems, a.is_secret,
          pa.progress, pa.completed, pa.completed_at, pa.created_at
        FROM achievements a
        LEFT JOIN player_achievements pa ON a.id = pa.achievement_id AND pa.player_id = $1
        WHERE a.is_active = true
        ORDER BY 
          pa.completed DESC,
          CASE a.rarity 
            WHEN 'common' THEN 1
            WHEN 'rare' THEN 2
            WHEN 'epic' THEN 3
            WHEN 'legendary' THEN 4
          END,
          a.target ASC
      `, [req.playerId]);

      // Separate completed and in-progress achievements
      const completed = [];
      const inProgress = [];
      const locked = [];

      playerAchievements.rows.forEach(achievement => {
        if (achievement.completed) {
          completed.push(achievement);
        } else if (achievement.progress > 0) {
          inProgress.push(achievement);
        } else {
          // Don't show secret achievements until they have progress
          if (!achievement.is_secret) {
            locked.push(achievement);
          }
        }
      });

      res.json({
        success: true,
        achievements: {
          completed,
          inProgress,
          locked,
          total: playerAchievements.rows.length,
          completedCount: completed.length
        }
      });

    } catch (error) {
      logger.error('Player achievements fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch player achievements' });
    }
  });

  /// 🔓 Unlock achievement (manual trigger for testing)
  router.post('/unlock', authenticateToken, async (req, res) => {
    try {
      const { achievementId } = req.body;

      if (!achievementId) {
        return res.status(400).json({ error: 'Achievement ID is required' });
      }

      // Check if achievement exists
      const achievement = await db.query(`
        SELECT id, title, target, reward_coins, reward_gems
        FROM achievements
        WHERE id = $1 AND is_active = true
      `, [achievementId]);

      if (achievement.rows.length === 0) {
        return res.status(404).json({ error: 'Achievement not found' });
      }

      const achievementData = achievement.rows[0];

      // Check if already completed
      const existing = await db.query(`
        SELECT completed
        FROM player_achievements
        WHERE player_id = $1 AND achievement_id = $2
      `, [req.playerId, achievementId]);

      if (existing.rows.length > 0 && existing.rows[0].completed) {
        return res.status(400).json({ error: 'Achievement already completed' });
      }

      // Unlock achievement
      await db.query(`
        INSERT INTO player_achievements (player_id, achievement_id, progress, completed, completed_at)
        VALUES ($1, $2, $3, true, NOW())
        ON CONFLICT (player_id, achievement_id)
        DO UPDATE SET 
          progress = $3,
          completed = true,
          completed_at = NOW()
      `, [req.playerId, achievementId, achievementData.target]);

      // Grant rewards
      if (achievementData.reward_coins > 0 || achievementData.reward_gems > 0) {
        await db.query(`
          UPDATE players
          SET 
            current_coins = current_coins + $2,
            current_gems = current_gems + $3
          WHERE id = $1
        `, [req.playerId, achievementData.reward_coins, achievementData.reward_gems]);
      }

      // Log achievement unlock for analytics
      await db.query(`
        INSERT INTO analytics_events (player_id, event_name, event_category, parameters)
        VALUES ($1, 'achievement_unlocked', 'achievements', $2)
      `, [req.playerId, JSON.stringify({
        achievementId,
        title: achievementData.title,
        rewardCoins: achievementData.reward_coins,
        rewardGems: achievementData.reward_gems
      })]);

      res.json({
        success: true,
        achievement: {
          id: achievementId,
          title: achievementData.title,
          rewardCoins: achievementData.reward_coins,
          rewardGems: achievementData.reward_gems
        },
        message: 'Achievement unlocked successfully'
      });

    } catch (error) {
      logger.error('Achievement unlock error:', error);
      res.status(500).json({ error: 'Failed to unlock achievement' });
    }
  });

  /// 📊 Get achievement statistics
  router.get('/stats', async (req, res) => {
    try {
      const stats = await db.query(`
        SELECT 
          COUNT(*) as total_achievements,
          COUNT(*) FILTER (WHERE rarity = 'common') as common_count,
          COUNT(*) FILTER (WHERE rarity = 'rare') as rare_count,
          COUNT(*) FILTER (WHERE rarity = 'epic') as epic_count,
          COUNT(*) FILTER (WHERE rarity = 'legendary') as legendary_count,
          COUNT(*) FILTER (WHERE is_secret = true) as secret_count
        FROM achievements
        WHERE is_active = true
      `);

      const playerStats = await db.query(`
        SELECT 
          COUNT(DISTINCT pa.player_id) as players_with_achievements,
          AVG(achievement_count) as avg_achievements_per_player
        FROM (
          SELECT player_id, COUNT(*) as achievement_count
          FROM player_achievements
          WHERE completed = true
          GROUP BY player_id
        ) pa
      `);

      const topAchievers = await db.query(`
        SELECT 
          p.nickname,
          COUNT(pa.id) as achievements_count
        FROM players p
        JOIN player_achievements pa ON p.id = pa.player_id
        WHERE pa.completed = true AND p.is_banned = false
        GROUP BY p.id, p.nickname
        ORDER BY achievements_count DESC
        LIMIT 10
      `);

      res.json({
        success: true,
        stats: {
          ...stats.rows[0],
          ...playerStats.rows[0],
          topAchievers: topAchievers.rows
        }
      });

    } catch (error) {
      logger.error('Achievement stats error:', error);
      res.status(500).json({ error: 'Failed to fetch achievement statistics' });
    }
  });

  return router;
};
