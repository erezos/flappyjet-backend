/// 🏆 Leaderboard Routes - Global rankings and score submission
const express = require('express');
const Joi = require('joi');

module.exports = (db) => {
  const router = express.Router();
  
  // Import auth middleware
  const authRoutes = require('./auth')(db);
  const authenticateToken = authRoutes.authenticateToken;

  // Validation schemas
  const submitScoreSchema = Joi.object({
    score: Joi.number().integer().min(0).max(100000).required(),
    survivalTime: Joi.number().integer().min(0).max(3600).required(), // Max 1 hour
    skinUsed: Joi.string().max(50).default('sky_jet'),
    coinsEarned: Joi.number().integer().min(0).max(10000).default(0),
    gemsEarned: Joi.number().integer().min(0).max(1000).default(0),
    difficultyPhase: Joi.number().integer().min(1).max(8).default(1),
    gameDuration: Joi.number().integer().min(1000).required(), // Minimum 1 second
    actionsPerSecond: Joi.number().min(0).max(20).optional()
  });

  /// 📊 Submit score to leaderboard
  router.post('/submit', authenticateToken, async (req, res) => {
    try {
      const { error, value } = submitScoreSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const {
        score,
        survivalTime,
        skinUsed,
        coinsEarned,
        gemsEarned,
        difficultyPhase,
        gameDuration,
        actionsPerSecond
      } = value;

      // Anti-cheat validation
      const isValidScore = await db.query(
        'SELECT validate_score_submission($1, $2, $3, $4) as is_valid',
        [req.playerId, score, gameDuration, survivalTime]
      );

      if (!isValidScore.rows[0].is_valid) {
        return res.status(400).json({ error: 'Invalid score submission' });
      }

      // Get client IP and user agent for anti-cheat
      const clientIp = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent') || '';

      // Insert score
      const scoreResult = await db.query(
        `INSERT INTO scores (
          player_id, score, survival_time, skin_used, coins_earned, gems_earned,
          difficulty_phase, game_duration, actions_per_second, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, created_at`,
        [
          req.playerId, score, survivalTime, skinUsed, coinsEarned, gemsEarned,
          difficultyPhase, gameDuration, actionsPerSecond, clientIp, userAgent
        ]
      );

      // Update player stats
      await db.query(
        `UPDATE players SET
          total_games_played = total_games_played + 1,
          total_coins_earned = total_coins_earned + $2,
          total_gems_earned = total_gems_earned + $3,
          current_coins = current_coins + $2,
          current_gems = current_gems + $3,
          best_score = GREATEST(best_score, $4),
          last_active_at = NOW()
        WHERE id = $1`,
        [req.playerId, coinsEarned, gemsEarned, score]
      );

      // Check for new achievements
      await checkAchievements(req.playerId, score, survivalTime);

      // Update missions progress
      await updateMissionsProgress(req.playerId, {
        gamesPlayed: 1,
        scoreAchieved: score,
        coinsEarned,
        survivalTime
      });

      // Get player's new rank
      const rankResult = await db.query(
        `SELECT COUNT(*) + 1 as rank
         FROM scores s
         JOIN players p ON s.player_id = p.id
         WHERE s.score > $1 
           AND s.created_at >= NOW() - INTERVAL '30 days'
           AND p.is_banned = FALSE`,
        [score]
      );

      const newRank = rankResult.rows[0].rank;

      // Check if this is a personal best
      const playerStats = await db.query(
        'SELECT best_score FROM players WHERE id = $1',
        [req.playerId]
      );

      const isPersonalBest = score >= playerStats.rows[0].best_score;

      res.json({
        success: true,
        scoreId: scoreResult.rows[0].id,
        rank: newRank,
        isPersonalBest,
        coinsEarned,
        gemsEarned,
        submittedAt: scoreResult.rows[0].created_at
      });

    } catch (error) {
      console.error('Score submission error:', error);
      res.status(500).json({ error: 'Failed to submit score' });
    }
  });

  /// 🌍 Get global leaderboard
  router.get('/global', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);
      const period = req.query.period || 'all_time'; // 'daily', 'weekly', 'monthly', 'all_time'

      let timeFilter = '';
      switch (period) {
        case 'daily':
          timeFilter = "AND s.created_at >= DATE_TRUNC('day', NOW())";
          break;
        case 'weekly':
          timeFilter = "AND s.created_at >= DATE_TRUNC('week', NOW())";
          break;
        case 'monthly':
          timeFilter = "AND s.created_at >= DATE_TRUNC('month', NOW())";
          break;
        case 'all_time':
        default:
          timeFilter = "AND s.created_at >= NOW() - INTERVAL '30 days'";
          break;
      }

      const leaderboard = await db.query(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY s.score DESC, s.created_at ASC) as rank,
          p.id as player_id,
          p.nickname,
          s.score,
          s.skin_used,
          s.created_at as achieved_at,
          p.country_code,
          CASE WHEN p.id = $3 THEN true ELSE false END as is_current_player
        FROM scores s
        JOIN players p ON s.player_id = p.id
        WHERE p.is_banned = FALSE ${timeFilter}
        ORDER BY s.score DESC, s.created_at ASC
        LIMIT $1 OFFSET $2
      `, [limit, offset, req.query.playerId || null]);

      // Get total count
      const countResult = await db.query(`
        SELECT COUNT(DISTINCT s.player_id) as total
        FROM scores s
        JOIN players p ON s.player_id = p.id
        WHERE p.is_banned = FALSE ${timeFilter}
      `);

      res.json({
        success: true,
        leaderboard: leaderboard.rows,
        pagination: {
          limit,
          offset,
          total: parseInt(countResult.rows[0].total)
        },
        period
      });

    } catch (error) {
      console.error('Leaderboard fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  /// 👤 Get player's leaderboard position
  router.get('/player/:playerId', async (req, res) => {
    try {
      const playerId = req.params.playerId;
      const period = req.query.period || 'all_time';

      let timeFilter = '';
      switch (period) {
        case 'daily':
          timeFilter = "AND s.created_at >= DATE_TRUNC('day', NOW())";
          break;
        case 'weekly':
          timeFilter = "AND s.created_at >= DATE_TRUNC('week', NOW())";
          break;
        case 'monthly':
          timeFilter = "AND s.created_at >= DATE_TRUNC('month', NOW())";
          break;
        case 'all_time':
        default:
          timeFilter = "AND s.created_at >= NOW() - INTERVAL '30 days'";
          break;
      }

      // Get player's best score and rank for the period
      const playerRank = await db.query(`
        WITH player_best AS (
          SELECT MAX(s.score) as best_score
          FROM scores s
          WHERE s.player_id = $1 ${timeFilter}
        ),
        leaderboard_ranks AS (
          SELECT 
            s.player_id,
            s.score,
            ROW_NUMBER() OVER (ORDER BY s.score DESC, s.created_at ASC) as rank
          FROM scores s
          JOIN players p ON s.player_id = p.id
          WHERE p.is_banned = FALSE ${timeFilter}
        )
        SELECT 
          lr.rank,
          lr.score,
          p.nickname,
          pb.best_score as player_best_score
        FROM leaderboard_ranks lr
        JOIN players p ON lr.player_id = p.id
        CROSS JOIN player_best pb
        WHERE lr.player_id = $1
        ORDER BY lr.score DESC
        LIMIT 1
      `, [playerId]);

      if (playerRank.rows.length === 0) {
        return res.json({
          success: true,
          rank: null,
          score: 0,
          message: 'Player has no scores in this period'
        });
      }

      // Get players around this rank (±5 positions)
      const contextRank = playerRank.rows[0].rank;
      const contextStart = Math.max(1, contextRank - 5);
      const contextEnd = contextRank + 5;

      const context = await db.query(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY s.score DESC, s.created_at ASC) as rank,
          p.id as player_id,
          p.nickname,
          s.score,
          s.skin_used,
          s.created_at as achieved_at,
          CASE WHEN p.id = $1 THEN true ELSE false END as is_current_player
        FROM scores s
        JOIN players p ON s.player_id = p.id
        WHERE p.is_banned = FALSE ${timeFilter}
        ORDER BY s.score DESC, s.created_at ASC
        LIMIT $2 OFFSET $3
      `, [playerId, contextEnd - contextStart + 1, contextStart - 1]);

      res.json({
        success: true,
        player: {
          rank: contextRank,
          score: playerRank.rows[0].score,
          nickname: playerRank.rows[0].nickname
        },
        context: context.rows,
        period
      });

    } catch (error) {
      console.error('Player rank fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch player rank' });
    }
  });

  /// 🏅 Check and update achievements
  async function checkAchievements(playerId, score, survivalTime) {
    try {
      // Score-based achievements
      const scoreAchievements = [
        { id: 'first_flight', target: 1 },
        { id: 'sky_rookie', target: 10 },
        { id: 'cloud_surfer', target: 25 },
        { id: 'storm_chaser', target: 50 },
        { id: 'sky_master', target: 100 },
        { id: 'legend_pilot', target: 200 }
      ];

      for (const achievement of scoreAchievements) {
        if (score >= achievement.target) {
          await db.query(`
            UPDATE player_achievements 
            SET progress = $3, completed = true, completed_at = NOW()
            WHERE player_id = $1 AND achievement_id = $2 AND completed = false
          `, [playerId, achievement.id, achievement.target]);
        }
      }

      // Survival time achievements
      if (survivalTime >= 60) {
        await db.query(`
          UPDATE player_achievements 
          SET progress = $3, completed = true, completed_at = NOW()
          WHERE player_id = $1 AND achievement_id = $2 AND completed = false
        `, [playerId, 'marathon_flyer', 60]);
      }

      if (survivalTime >= 120) {
        await db.query(`
          UPDATE player_achievements 
          SET progress = $3, completed = true, completed_at = NOW()
          WHERE player_id = $1 AND achievement_id = $2 AND completed = false
        `, [playerId, 'endurance_ace', 120]);
      }

      // Games played achievements
      const gamesPlayed = await db.query(
        'SELECT total_games_played FROM players WHERE id = $1',
        [playerId]
      );

      const totalGames = gamesPlayed.rows[0].total_games_played;
      const gameAchievements = [
        { id: 'dedicated_pilot', target: 10 },
        { id: 'frequent_flyer', target: 50 },
        { id: 'sky_veteran', target: 100 }
      ];

      for (const achievement of gameAchievements) {
        if (totalGames >= achievement.target) {
          await db.query(`
            UPDATE player_achievements 
            SET progress = $3, completed = true, completed_at = NOW()
            WHERE player_id = $1 AND achievement_id = $2 AND completed = false
          `, [playerId, achievement.id, achievement.target]);
        }
      }

    } catch (error) {
      console.error('Achievement check error:', error);
    }
  }

  /// 🎯 Update missions progress
  async function updateMissionsProgress(playerId, gameData) {
    try {
      const { gamesPlayed, scoreAchieved, coinsEarned, survivalTime } = gameData;

      // Update play games missions
      if (gamesPlayed > 0) {
        await db.query(`
          UPDATE player_missions 
          SET progress = LEAST(progress + $2, target)
          WHERE player_id = $1 
            AND mission_type = 'play_games' 
            AND completed = false 
            AND expires_at > NOW()
        `, [playerId, gamesPlayed]);
      }

      // Update reach score missions
      if (scoreAchieved > 0) {
        await db.query(`
          UPDATE player_missions 
          SET progress = GREATEST(progress, $2),
              completed = CASE WHEN $2 >= target THEN true ELSE completed END,
              completed_at = CASE WHEN $2 >= target AND completed = false THEN NOW() ELSE completed_at END
          WHERE player_id = $1 
            AND mission_type = 'reach_score' 
            AND completed = false 
            AND expires_at > NOW()
        `, [playerId, scoreAchieved]);
      }

      // Update collect coins missions
      if (coinsEarned > 0) {
        await db.query(`
          UPDATE player_missions 
          SET progress = LEAST(progress + $2, target)
          WHERE player_id = $1 
            AND mission_type = 'collect_coins' 
            AND completed = false 
            AND expires_at > NOW()
        `, [playerId, coinsEarned]);
      }

      // Update survive time missions
      if (survivalTime > 0) {
        await db.query(`
          UPDATE player_missions 
          SET progress = GREATEST(progress, $2),
              completed = CASE WHEN $2 >= target THEN true ELSE completed END,
              completed_at = CASE WHEN $2 >= target AND completed = false THEN NOW() ELSE completed_at END
          WHERE player_id = $1 
            AND mission_type = 'survive_time' 
            AND completed = false 
            AND expires_at > NOW()
        `, [playerId, survivalTime]);
      }

      // Mark completed missions
      await db.query(`
        UPDATE player_missions 
        SET completed = true, completed_at = NOW()
        WHERE player_id = $1 
          AND progress >= target 
          AND completed = false 
          AND expires_at > NOW()
      `, [playerId]);

    } catch (error) {
      console.error('Missions progress update error:', error);
    }
  }

  return router;
};
