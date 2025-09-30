/// 🎭 Anonymous Routes - Support for anonymous players
/// Allows limited functionality without full authentication
const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const logger = require('../utils/logger');

module.exports = (db) => {
  const router = express.Router();
  
  const JWT_SECRET = process.env.JWT_SECRET || 'flappyjet-dev-secret-change-in-production';
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

  // Validation schemas
  const linkAccountSchema = Joi.object({
    anonymousId: Joi.string().required().min(10).max(255),
    nickname: Joi.string().min(1).max(50).required(),
    platform: Joi.string().valid('ios', 'android', 'web').default('unknown'),
    appVersion: Joi.string().max(20).default('1.0.0'),
    countryCode: Joi.string().length(2).optional(),
    timezone: Joi.string().max(50).optional(),
    // Anonymous player data to merge
    localProgress: Joi.object({
      bestScore: Joi.number().min(0).default(0),
      totalGamesPlayed: Joi.number().min(0).default(0),
      currentCoins: Joi.number().min(0).default(0),
      currentGems: Joi.number().min(0).default(0),
      ownedSkins: Joi.array().items(Joi.string()).default([]),
      achievements: Joi.array().items(Joi.object()).default([]),
    }).optional(),
  });

  /// 🔗 Link anonymous account to cloud
  router.post('/link-account', async (req, res) => {
    const startTime = Date.now();
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection.remoteAddress;
    
    try {
      const { error, value } = linkAccountSchema.validate(req.body);
      if (error) {
        logger.warn('🎭 ACCOUNT LINKING FAILED - VALIDATION ERROR', {
          reason: error.details[0].message,
          clientIP,
          anonymousId: req.body.anonymousId?.substring(0, 8) + '***',
          responseTime: Date.now() - startTime
        });
        return res.status(400).json({ error: error.details[0].message });
      }

      const { 
        anonymousId, 
        nickname, 
        platform, 
        appVersion, 
        countryCode, 
        timezone,
        localProgress,
        masterId // Add master ID for data recovery
      } = value;

      // Enhanced country detection
      let detectedCountry = countryCode || getCountryFromIP(req) || 'US';

      // Check if anonymous player already linked
      const existingLink = await db.query(
        'SELECT player_id FROM anonymous_links WHERE anonymous_id = $1',
        [anonymousId]
      );

      if (existingLink.rows.length > 0) {
        // Already linked - return existing account
        const playerId = existingLink.rows[0].player_id;
        const playerData = await db.query(
          `SELECT id, nickname, best_score, best_streak, total_games_played,
                  current_coins, current_gems, current_hearts, is_premium,
                  heart_booster_expiry, created_at
           FROM players WHERE id = $1`,
          [playerId]
        );

        if (playerData.rows.length > 0) {
          const token = generateToken(playerId, {
            nickname: playerData.rows[0].nickname,
            deviceId: anonymousId
          });

          logger.info('🎭 EXISTING ACCOUNT LINKED', {
            playerId,
            anonymousId: anonymousId.substring(0, 8) + '***',
            clientIP,
            responseTime: Date.now() - startTime
          });

          return res.json({
            success: true,
            isNewPlayer: false,
            token,
            player: {
              ...playerData.rows[0],
              heartBoosterActive: playerData.rows[0].heart_booster_expiry && 
                                new Date(playerData.rows[0].heart_booster_expiry) > new Date()
            }
          });
        }
      }

      // Create new cloud account
      const newPlayer = await db.query(
        `INSERT INTO players (
          device_id, nickname, platform, app_version, 
          country_code, timezone, created_at, last_active_at,
          best_score, total_games_played, current_coins, current_gems,
          master_id
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7, $8, $9, $10, $11)
        RETURNING id`,
        [
          anonymousId, 
          nickname, 
          platform, 
          appVersion, 
          detectedCountry, 
          timezone,
          localProgress?.bestScore || 0,
          localProgress?.totalGamesPlayed || 0,
          localProgress?.currentCoins || 500,
          localProgress?.currentGems || 25,
          masterId || null // Store master ID for recovery
        ]
      );
      
      const playerId = newPlayer.rows[0].id;

      // Create anonymous link
      await db.query(
        `INSERT INTO anonymous_links (anonymous_id, player_id, linked_at)
         VALUES ($1, $2, NOW())`,
        [anonymousId, playerId]
      );

      // Merge local inventory if provided
      if (localProgress?.ownedSkins && localProgress.ownedSkins.length > 0) {
        for (const skinId of localProgress.ownedSkins) {
          await db.query(
            `INSERT INTO player_inventory (player_id, item_type, item_id, equipped, acquired_method)
             VALUES ($1, 'skin', $2, false, 'anonymous_merge')
             ON CONFLICT (player_id, item_type, item_id) DO NOTHING`,
            [playerId, skinId]
          );
        }
      }

      // Grant starter achievements
      await grantStarterAchievements(playerId);
      
      // Grant starter skin if not already owned
      await db.query(
        `INSERT INTO player_inventory (player_id, item_type, item_id, equipped, acquired_method)
         VALUES ($1, 'skin', 'sky_jet', true, 'starter')
         ON CONFLICT (player_id, item_type, item_id) DO NOTHING`,
        [playerId]
      );

      // Generate JWT token
      const token = generateToken(playerId, {
        nickname: nickname,
        deviceId: anonymousId
      });

      // Get final player data
      const playerData = await db.query(
        `SELECT id, nickname, best_score, best_streak, total_games_played,
                current_coins, current_gems, current_hearts, is_premium,
                heart_booster_expiry, created_at
         FROM players WHERE id = $1`,
        [playerId]
      );

      logger.info('🎭 NEW ACCOUNT LINKED', {
        playerId,
        nickname,
        anonymousId: anonymousId.substring(0, 8) + '***',
        platform,
        clientIP,
        mergedProgress: !!localProgress,
        responseTime: Date.now() - startTime
      });

      res.json({
        success: true,
        isNewPlayer: true,
        token,
        player: {
          id: playerId,
          ...playerData.rows[0],
          heartBoosterActive: playerData.rows[0].heart_booster_expiry && 
                            new Date(playerData.rows[0].heart_booster_expiry) > new Date()
        }
      });

    } catch (error) {
      logger.error('🎭 ACCOUNT LINKING ERROR', {
        error: error.message,
        clientIP,
        anonymousId: req.body.anonymousId?.substring(0, 8) + '***',
        responseTime: Date.now() - startTime
      });
      res.status(500).json({ error: 'Account linking failed' });
    }
  });

  /// 📊 Get anonymous leaderboard (limited, no personal data)
  router.get('/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 10, 50);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);

      const leaderboard = await db.query(
        `SELECT 
          ROW_NUMBER() OVER (ORDER BY best_score DESC, created_at ASC) as rank,
          nickname,
          best_score,
          platform,
          country_code
         FROM players 
         WHERE best_score > 0 
         ORDER BY best_score DESC, created_at ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      res.json({
        success: true,
        leaderboard: leaderboard.rows.map(row => ({
          rank: parseInt(row.rank),
          nickname: row.nickname,
          score: row.best_score,
          platform: row.platform,
          country: row.country_code
        }))
      });

    } catch (error) {
      logger.error('🎭 ANONYMOUS LEADERBOARD ERROR', error);
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  /// 🔄 Recover data using master ID
  router.post('/recover-data', async (req, res) => {
    try {
      const { masterId } = req.body;

      if (!masterId) {
        return res.status(400).json({ error: 'Master ID required' });
      }

      // Check if master ID has cloud data
      const player = await db.query(
        'SELECT * FROM players WHERE master_id = $1',
        [masterId]
      );

      if (player.rows.length > 0) {
        const playerData = player.rows[0];
        
        logger.info('🎭 DATA RECOVERY SUCCESS', {
          masterId: masterId.substring(0, 8) + '***',
          playerId: playerData.id,
          nickname: playerData.nickname
        });

        res.json({
          success: true,
          canRecover: true,
          playerData: {
            id: playerData.id,
            nickname: playerData.nickname,
            bestScore: playerData.best_score,
            coins: playerData.current_coins,
            gems: playerData.current_gems,
            platform: playerData.platform,
            createdAt: playerData.created_at
          }
        });
      } else {
        logger.info('🎭 DATA RECOVERY - NO DATA FOUND', {
          masterId: masterId.substring(0, 8) + '***'
        });

        res.json({
          success: true,
          canRecover: false,
          message: 'No cloud data found for this master ID'
        });
      }

    } catch (error) {
      logger.error('🎭 DATA RECOVERY ERROR', error);
      res.status(500).json({ error: 'Data recovery failed' });
    }
  });

  /// 🎯 Submit anonymous score (limited functionality)
  router.post('/submit-score', async (req, res) => {
    try {
      const { anonymousId, score, survivalTime } = req.body;

      if (!anonymousId || typeof score !== 'number' || score < 0) {
        return res.status(400).json({ error: 'Invalid score data' });
      }

      // Store anonymous score (temporary, for local leaderboard)
      await db.query(
        `INSERT INTO anonymous_scores (anonymous_id, score, survival_time, submitted_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (anonymous_id) 
         DO UPDATE SET 
           score = GREATEST(anonymous_scores.score, $2),
           survival_time = CASE WHEN $2 > anonymous_scores.score THEN $3 ELSE anonymous_scores.survival_time END,
           submitted_at = NOW()`,
        [anonymousId, score, survivalTime]
      );

      logger.info('🎭 ANONYMOUS SCORE SUBMITTED', {
        anonymousId: anonymousId.substring(0, 8) + '***',
        score,
        survivalTime
      });

      res.json({
        success: true,
        message: 'Score recorded locally. Connect to cloud for global leaderboards!'
      });

    } catch (error) {
      logger.error('🎭 ANONYMOUS SCORE ERROR', error);
      res.status(500).json({ error: 'Failed to submit score' });
    }
  });

  /// 🏆 Grant starter achievements to new players
  async function grantStarterAchievements(playerId) {
    try {
      const starterAchievements = ['first_flight'];

      for (const achievementId of starterAchievements) {
        await db.query(
          `INSERT INTO player_achievements (player_id, achievement_id, progress)
           VALUES ($1, $2, 0)
           ON CONFLICT (player_id, achievement_id) DO NOTHING`,
          [playerId, achievementId]
        );
      }
    } catch (error) {
      logger.error('Error granting starter achievements:', error);
    }
  }

  /// 🌍 Get country code from IP address
  function getCountryFromIP(req) {
    try {
      const forwarded = req.headers['x-forwarded-for'];
      const ip = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;
      
      if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return null;
      }

      logger.info(`🌍 Detecting country for IP: ${ip}`);
      return null; // Implement proper GeoIP service
    } catch (error) {
      logger.error('Error detecting country from IP:', error);
      return null;
    }
  }

  /// Generate JWT token
  const generateToken = (playerId, playerData = {}) => {
    const payload = {
      playerId: playerId,
      username: playerData.nickname || playerData.username || 'Anonymous',
      deviceId: playerData.deviceId,
      iat: Math.floor(Date.now() / 1000)
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  };

  return router;
};
