/// 🎯 Missions Routes - Adaptive daily missions system
const express = require('express');
const Joi = require('joi');

module.exports = (db) => {
  const router = express.Router();
  
  // Import auth middleware
  const authRoutes = require('./auth')(db);
  const authenticateToken = authRoutes.authenticateToken;

  // Validation schemas
  const updateProgressSchema = Joi.object({
    missionType: Joi.string().valid(
      'play_games', 'reach_score', 'maintain_streak', 'use_continue',
      'collect_coins', 'survive_time', 'change_nickname'
    ).required(),
    amount: Joi.number().integer().min(0).max(10000).required()
  });

  /// 📋 Get player's current daily missions
  router.get('/daily', authenticateToken, async (req, res) => {
    try {
      // Get player's active missions
      const missions = await db.query(`
        SELECT 
          id, mission_type, difficulty_level, title, description,
          target, reward, progress, completed, completed_at,
          expires_at, created_at
        FROM player_missions
        WHERE player_id = $1 
          AND expires_at > NOW()
        ORDER BY created_at ASC
      `, [req.playerId]);

      // If no missions or missions expired, generate new ones
      if (missions.rows.length === 0) {
        await generateDailyMissions(req.playerId);
        
        // Fetch the newly generated missions
        const newMissions = await db.query(`
          SELECT 
            id, mission_type, difficulty_level, title, description,
            target, reward, progress, completed, completed_at,
            expires_at, created_at
          FROM player_missions
          WHERE player_id = $1 
            AND expires_at > NOW()
          ORDER BY created_at ASC
        `, [req.playerId]);

        return res.json({
          success: true,
          missions: newMissions.rows,
          generated: true
        });
      }

      res.json({
        success: true,
        missions: missions.rows,
        generated: false
      });

    } catch (error) {
      console.error('Daily missions fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch daily missions' });
    }
  });

  /// 📈 Update mission progress
  router.post('/progress', authenticateToken, async (req, res) => {
    try {
      const { error, value } = updateProgressSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { missionType, amount } = value;

      // Update mission progress
      const updateResult = await db.query(`
        UPDATE player_missions 
        SET 
          progress = LEAST(progress + $3, target),
          completed = CASE WHEN progress + $3 >= target THEN true ELSE completed END,
          completed_at = CASE WHEN progress + $3 >= target AND completed = false THEN NOW() ELSE completed_at END
        WHERE player_id = $1 
          AND mission_type = $2 
          AND completed = false 
          AND expires_at > NOW()
        RETURNING id, progress, target, completed, reward, title
      `, [req.playerId, missionType, amount]);

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: 'No active mission found for this type' });
      }

      const mission = updateResult.rows[0];
      let rewardGranted = 0;

      // Grant reward if mission completed
      if (mission.completed && mission.progress >= mission.target) {
        await db.query(`
          UPDATE players 
          SET current_coins = current_coins + $2
          WHERE id = $1
        `, [req.playerId, mission.reward]);

        rewardGranted = mission.reward;

        // Log mission completion for analytics
        await db.query(`
          INSERT INTO analytics_events (player_id, event_name, event_category, parameters)
          VALUES ($1, 'mission_completed', 'missions', $2)
        `, [req.playerId, JSON.stringify({
          missionId: mission.id,
          missionType,
          reward: mission.reward,
          title: mission.title
        })]);
      }

      res.json({
        success: true,
        mission: {
          id: mission.id,
          progress: mission.progress,
          target: mission.target,
          completed: mission.completed
        },
        rewardGranted
      });

    } catch (error) {
      console.error('Mission progress update error:', error);
      res.status(500).json({ error: 'Failed to update mission progress' });
    }
  });

  /// 🔄 Force refresh daily missions (for testing)
  router.post('/refresh', authenticateToken, async (req, res) => {
    try {
      // Mark current missions as expired
      await db.query(`
        UPDATE player_missions 
        SET expires_at = NOW() - INTERVAL '1 hour'
        WHERE player_id = $1 AND expires_at > NOW()
      `, [req.playerId]);

      // Generate new missions
      await generateDailyMissions(req.playerId);

      // Fetch new missions
      const missions = await db.query(`
        SELECT 
          id, mission_type, difficulty_level, title, description,
          target, reward, progress, completed, completed_at,
          expires_at, created_at
        FROM player_missions
        WHERE player_id = $1 
          AND expires_at > NOW()
        ORDER BY created_at ASC
      `, [req.playerId]);

      res.json({
        success: true,
        missions: missions.rows,
        message: 'Daily missions refreshed'
      });

    } catch (error) {
      console.error('Mission refresh error:', error);
      res.status(500).json({ error: 'Failed to refresh missions' });
    }
  });

  /// 🎯 Generate adaptive daily missions for player
  async function generateDailyMissions(playerId) {
    try {
      // Get player stats for adaptive generation
      const playerStats = await db.query(`
        SELECT 
          best_score, best_streak, total_games_played,
          COALESCE(
            (SELECT COUNT(*) FROM player_missions 
             WHERE player_id = $1 AND mission_type = 'change_nickname' AND completed = true), 
            0
          ) as nickname_changes
        FROM players 
        WHERE id = $1
      `, [playerId]);

      if (playerStats.rows.length === 0) {
        throw new Error('Player not found');
      }

      const stats = playerStats.rows[0];
      const skillLevel = determineSkillLevel(stats.best_score);

      // Generate 4 daily missions
      const missions = [];

      // 1. Play games mission (easy)
      missions.push(generatePlayGamesMission(skillLevel));

      // 2. Reach score mission (easy/medium)
      missions.push(generateReachScoreMission(skillLevel, stats.best_score));

      // 3. Streak mission (medium)
      missions.push(generateStreakMission(skillLevel));

      // 4. Variable mission based on player behavior
      if (stats.nickname_changes === 0 && Math.random() < 0.3) {
        missions.push(generateNicknameMission());
      } else {
        const variableMissions = ['use_continue', 'collect_coins', 'survive_time'];
        const randomType = variableMissions[Math.floor(Math.random() * variableMissions.length)];
        missions.push(generateVariableMission(randomType, skillLevel));
      }

      // Insert missions into database
      const expiresAt = new Date();
      expiresAt.setHours(23, 59, 59, 999); // End of day

      for (const mission of missions) {
        await db.query(`
          INSERT INTO player_missions (
            player_id, mission_type, difficulty_level, title, description,
            target, reward, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          playerId, mission.type, mission.difficulty, mission.title,
          mission.description, mission.target, mission.reward, expiresAt
        ]);
      }

      console.log(`Generated ${missions.length} daily missions for player ${playerId}`);

    } catch (error) {
      console.error('Mission generation error:', error);
      throw error;
    }
  }

  /// 🎮 Determine player skill level
  function determineSkillLevel(bestScore) {
    if (bestScore < 10) return 'beginner';
    if (bestScore < 25) return 'novice';
    if (bestScore < 50) return 'intermediate';
    if (bestScore < 100) return 'advanced';
    return 'expert';
  }

  /// 🎯 Mission generators
  function generatePlayGamesMission(skillLevel) {
    const configs = {
      beginner: { target: 3, reward: 75 },
      novice: { target: 4, reward: 100 },
      intermediate: { target: 5, reward: 150 },
      advanced: { target: 6, reward: 200 },
      expert: { target: 8, reward: 300 }
    };

    const config = configs[skillLevel];
    return {
      type: 'play_games',
      difficulty: 'easy',
      title: 'Take Flight',
      description: `Play ${config.target} games today`,
      target: config.target,
      reward: config.reward
    };
  }

  function generateReachScoreMission(skillLevel, bestScore) {
    let target, reward;

    if (bestScore <= 5) {
      target = 3;
      reward = 75;
    } else if (bestScore <= 10) {
      target = Math.max(5, Math.round(bestScore * 0.6));
      reward = 100;
    } else if (bestScore <= 25) {
      target = Math.round(bestScore * 0.7);
      reward = 150;
    } else if (bestScore <= 50) {
      target = Math.round(bestScore * 0.75);
      reward = 200;
    } else {
      target = Math.round(bestScore * 0.8);
      reward = 300;
    }

    return {
      type: 'reach_score',
      difficulty: bestScore <= 10 ? 'easy' : 'medium',
      title: 'Sky Achievement',
      description: `Reach ${target} points in a single game`,
      target,
      reward
    };
  }

  function generateStreakMission(skillLevel) {
    const configs = {
      beginner: { streakLength: 2, threshold: 3, reward: 100 },
      novice: { streakLength: 3, threshold: 5, reward: 150 },
      intermediate: { streakLength: 3, threshold: 10, reward: 200 },
      advanced: { streakLength: 4, threshold: 20, reward: 300 },
      expert: { streakLength: 5, threshold: 30, reward: 500 }
    };

    const config = configs[skillLevel];
    return {
      type: 'maintain_streak',
      difficulty: 'medium',
      title: 'Consistency Master',
      description: `Score above ${config.threshold} in ${config.streakLength} consecutive games`,
      target: config.streakLength,
      reward: config.reward
    };
  }

  function generateVariableMission(type, skillLevel) {
    switch (type) {
      case 'use_continue':
        return {
          type: 'use_continue',
          difficulty: 'medium',
          title: 'Never Give Up',
          description: `Use continue ${skillLevel === 'expert' ? 4 : 2} times`,
          target: skillLevel === 'expert' ? 4 : 2,
          reward: skillLevel === 'expert' ? 300 : 150
        };

      case 'collect_coins':
        const coinTarget = skillLevel === 'expert' ? 500 : 250;
        return {
          type: 'collect_coins',
          difficulty: skillLevel === 'expert' ? 'hard' : 'medium',
          title: 'Treasure Hunter',
          description: `Collect ${coinTarget} coins from any source`,
          target: coinTarget,
          reward: skillLevel === 'expert' ? 200 : 100
        };

      case 'survive_time':
        const timeTarget = ['advanced', 'expert'].includes(skillLevel) ? 60 : 30;
        return {
          type: 'survive_time',
          difficulty: timeTarget === 60 ? 'hard' : 'medium',
          title: 'Endurance Test',
          description: `Survive for ${timeTarget} seconds in a single game`,
          target: timeTarget,
          reward: timeTarget === 60 ? 400 : 200
        };

      default:
        return generatePlayGamesMission(skillLevel);
    }
  }

  function generateNicknameMission() {
    return {
      type: 'change_nickname',
      difficulty: 'easy',
      title: 'Personal Touch',
      description: 'Change your nickname to personalize your profile',
      target: 1,
      reward: 200
    };
  }

  return router;
};
