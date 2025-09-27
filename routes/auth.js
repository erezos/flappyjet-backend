/// 🔐 Authentication Routes - JWT-based player authentication
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const logger = require('../utils/logger');
const authAnalytics = require('../utils/auth-analytics');
const GeoIPService = require('../services/geoip-service');

module.exports = (db) => {
  const router = express.Router();
  
  const JWT_SECRET = process.env.JWT_SECRET || 'flappyjet-dev-secret-change-in-production';
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

  // Validation schemas
  const registerSchema = Joi.object({
    deviceId: Joi.string().required().min(3).max(255),
    nickname: Joi.string().min(1).max(50).default('Pilot'),
    platform: Joi.string().valid('ios', 'android', 'web').default('unknown'),
    appVersion: Joi.string().max(20).default('1.0.0'),
    countryCode: Joi.string().length(2).optional(),
    timezone: Joi.string().max(50).optional()
  });

  const loginSchema = Joi.object({
    deviceId: Joi.string().required().min(3).max(255),
    platform: Joi.string().valid('ios', 'android', 'web').default('unknown'),
    appVersion: Joi.string().max(20).default('1.0.0')
  });

  // Generate JWT token with player data
  const generateToken = (playerId, playerData = {}) => {
    const payload = {
      playerId: playerId,
      username: playerData.nickname || playerData.username || 'Anonymous',
      deviceId: playerData.deviceId,
      iat: Math.floor(Date.now() / 1000)
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  };

  // Middleware to verify JWT token
  const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.playerId = decoded.playerId;
      next();
    });
  };

  /// 📝 Register new player or login existing
  router.post('/register', async (req, res) => {
    const startTime = Date.now();
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection.remoteAddress;
    
    try {
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        // Single clear log for validation failure
        logger.warn('🔐 REGISTRATION FAILED - VALIDATION ERROR', {
          reason: error.details[0].message,
          clientIP,
          deviceId: req.body.deviceId?.substring(0, 8) + '***',
          platform: req.body.platform,
          responseTime: Date.now() - startTime
        });
        
        // Track validation failure
        authAnalytics.trackAuthFailure({
          clientIP,
          endpoint: '/auth/register',
          reason: 'validation_failed',
          userAgent: req.get('User-Agent')
        });
        
        return res.status(400).json({ error: error.details[0].message });
      }

      const { deviceId, nickname, platform, appVersion, countryCode, timezone } = value;

      // 🌍 Enhanced country detection: Use client-provided country, fallback to IP-based detection
      let detectedCountry = countryCode;
      
      // Only use IP detection if client didn't provide a country or sent a clearly default value
      // We assume 'US' might be a default/hardcoded value from older app versions
      if (!detectedCountry) {
        // No country provided - try IP detection
        const realIP = GeoIPService.extractRealIP(req);
        detectedCountry = await GeoIPService.getCountryFromIP(realIP) || 'US';
        logger.info(`🌍 No country provided, IP detection result: ${detectedCountry}`);
      } else if (countryCode === 'US') {
        // Client sent 'US' - could be real US user or hardcoded default
        // Try IP detection as additional validation, but keep 'US' if IP fails
        const realIP = GeoIPService.extractRealIP(req);
        const ipCountry = await GeoIPService.getCountryFromIP(realIP);
        if (ipCountry) {
          detectedCountry = ipCountry;
          if (ipCountry !== 'US') {
            logger.info(`🌍 IP-based country override: Client sent 'US' but IP suggests '${ipCountry}'`);
          }
        } else {
          detectedCountry = 'US';
        }
      }
      // For any other country code (FR, DE, JP, etc.), trust the client

      // Check if player already exists
      const existingPlayer = await db.query(
        'SELECT id, nickname, created_at FROM players WHERE device_id = $1',
        [deviceId]
      );

      let playerId;
      let isNewPlayer = false;

      if (existingPlayer.rows.length > 0) {
        // Existing player - update last active
        playerId = existingPlayer.rows[0].id;
        
        await db.query(
          `UPDATE players 
           SET last_active_at = NOW(), platform = $2, app_version = $3
           WHERE id = $1`,
          [playerId, platform, appVersion]
        );
      } else {
        // New player - create account
        const newPlayer = await db.query(
          `INSERT INTO players (
            device_id, nickname, platform, app_version, 
            country_code, timezone, created_at, last_active_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING id`,
          [deviceId, nickname, platform, appVersion, detectedCountry, timezone]
        );
        
        playerId = newPlayer.rows[0].id;
        isNewPlayer = true;

        // Grant starter achievements
        await grantStarterAchievements(playerId);
        
        // Grant starter skin
        await db.query(
          `INSERT INTO player_inventory (player_id, item_type, item_id, equipped, acquired_method)
           VALUES ($1, 'skin', 'sky_jet', true, 'starter')`,
          [playerId]
        );
      }

      // Generate JWT token with player data
      const token = generateToken(playerId, {
        nickname: nickname,
        deviceId: deviceId
      });

      // Get player data
      const playerData = await db.query(
        `SELECT id, nickname, best_score, best_streak, total_games as total_games_played,
                current_coins, current_gems, current_hearts, is_premium,
                heart_booster_expiry, created_at
         FROM players WHERE id = $1`,
        [playerId]
      );

      // Single clear log for registration success
      if (isNewPlayer) {
        logger.info('🔐 NEW USER REGISTERED', {
          playerId,
          nickname,
          platform,
          clientIP,
          deviceId: deviceId.substring(0, 8) + '***',
          responseTime: Date.now() - startTime
        });
      } else {
        logger.info('🔐 EXISTING USER LOGIN VIA REGISTER', {
          playerId,
          nickname,
          platform,
          clientIP,
          deviceId: deviceId.substring(0, 8) + '***',
          responseTime: Date.now() - startTime
        });
      }

      // Track registration analytics
      authAnalytics.trackRegistration({
        playerId,
        clientIP,
        platform,
        isNewPlayer,
        deviceId,
        nickname,
        appVersion
      });

      res.json({
        success: true,
        isNewPlayer,
        token,
        player: {
          id: playerId,
          ...playerData.rows[0],
          heartBoosterActive: playerData.rows[0].heart_booster_expiry && 
                            new Date(playerData.rows[0].heart_booster_expiry) > new Date()
        }
      });

    } catch (error) {
      logger.error('🔐 REGISTRATION ERROR', {
        error: error.message,
        clientIP,
        deviceId: req.body.deviceId?.substring(0, 8) + '***',
        platform: req.body.platform,
        responseTime: Date.now() - startTime
      });
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  /// 🔑 Login existing player
  router.post('/login', async (req, res) => {
    const startTime = Date.now();
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection.remoteAddress;
    
    try {
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        logger.warn('🔐 LOGIN FAILED - VALIDATION ERROR', {
          reason: error.details[0].message,
          clientIP,
          deviceId: req.body.deviceId?.substring(0, 8) + '***',
          platform: req.body.platform,
          responseTime: Date.now() - startTime
        });
        return res.status(400).json({ error: error.details[0].message });
      }

      const { deviceId, platform, appVersion } = value;

      // Find player by device ID
      const player = await db.query(
        `SELECT id, nickname, best_score, best_streak, total_games as total_games_played,
                current_coins, current_gems, current_hearts, is_premium,
                heart_booster_expiry, created_at, is_banned, ban_reason
         FROM players WHERE device_id = $1`,
        [deviceId]
      );

      if (player.rows.length === 0) {
        logger.warn('🔐 LOGIN FAILED - PLAYER NOT FOUND', {
          clientIP,
          deviceId: deviceId.substring(0, 8) + '***',
          platform,
          responseTime: Date.now() - startTime
        });
        
        // Track login failure
        authAnalytics.trackLogin({
          playerId: null,
          clientIP,
          platform,
          success: false,
          reason: 'player_not_found',
          deviceId,
          appVersion
        });
        
        return res.status(404).json({ error: 'Player not found. Please register first.' });
      }

      const playerData = player.rows[0];

      // Check if player is banned
      if (playerData.is_banned) {
        logger.warn('🔐 LOGIN FAILED - PLAYER BANNED', {
          playerId: playerData.id,
          nickname: playerData.nickname,
          banReason: playerData.ban_reason,
          clientIP,
          deviceId: deviceId.substring(0, 8) + '***',
          platform,
          responseTime: Date.now() - startTime
        });
        
        // Track banned login attempt
        authAnalytics.trackLogin({
          playerId: playerData.id,
          clientIP,
          platform,
          success: false,
          reason: 'player_banned',
          deviceId,
          appVersion
        });
        
        return res.status(403).json({ 
          error: 'Account banned', 
          reason: playerData.ban_reason 
        });
      }

      // Single clear log for successful login
      logger.info('🔐 EXISTING USER LOGIN SUCCESS', {
        playerId: playerData.id,
        nickname: playerData.nickname,
        platform,
        clientIP,
        deviceId: deviceId.substring(0, 8) + '***',
        responseTime: Date.now() - startTime
      });

      // Track login analytics
      authAnalytics.trackLogin({
        playerId: playerData.id,
        clientIP,
        platform,
        success: true,
        deviceId,
        nickname: playerData.nickname,
        appVersion
      });

      // Update last active and platform info
      await db.query(
        `UPDATE players 
         SET last_active_at = NOW(), platform = $2, app_version = $3
         WHERE id = $1`,
        [playerData.id, platform, appVersion]
      );

      // Generate JWT token with player data
      const token = generateToken(playerData.id, {
        nickname: playerData.nickname,
        deviceId: playerData.device_id
      });

      res.json({
        success: true,
        token,
        player: {
          ...playerData,
          heartBoosterActive: playerData.heart_booster_expiry && 
                            new Date(playerData.heart_booster_expiry) > new Date()
        }
      });

    } catch (error) {
      logger.error('🔐 LOGIN ERROR', {
        error: error.message,
        clientIP,
        deviceId: req.body.deviceId?.substring(0, 8) + '***',
        platform: req.body.platform,
        responseTime: Date.now() - startTime
      });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  /// 🔄 Refresh token
  router.post('/refresh', authenticateToken, async (req, res) => {
    const startTime = Date.now();
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection.remoteAddress;
    
    try {

      // Verify player still exists and is not banned
      const player = await db.query(
        'SELECT id, is_banned FROM players WHERE id = $1',
        [req.playerId]
      );

      if (player.rows.length === 0 || player.rows[0].is_banned) {
        logger.warn('🔐 TOKEN REFRESH FAILED - INVALID PLAYER', {
          playerId: req.playerId,
          clientIP,
          playerExists: player.rows.length > 0,
          isBanned: player.rows[0]?.is_banned,
          responseTime: Date.now() - startTime
        });
        return res.status(403).json({ error: 'Invalid player or account banned' });
      }

      // Get player data for token generation
      const playerData = await db.query(
        'SELECT nickname, device_id FROM players WHERE id = $1',
        [req.playerId]
      );
      
      // Generate new token with player data
      const token = generateToken(req.playerId, {
        nickname: playerData.rows[0]?.nickname,
        deviceId: playerData.rows[0]?.device_id
      });

      // Only log token refresh in debug mode to avoid spam
      if (process.env.NODE_ENV === 'development') {
        logger.debug('🔐 TOKEN REFRESH SUCCESS', {
          playerId: req.playerId,
          responseTime: Date.now() - startTime
        });
      }

      res.json({
        success: true,
        token
      });

    } catch (error) {
      logger.error('🔐 TOKEN REFRESH ERROR', {
        error: error.message,
        playerId: req.playerId,
        clientIP,
        responseTime: Date.now() - startTime
      });
      res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  /// 👤 Get current player profile with inventory
  router.get('/profile', authenticateToken, async (req, res) => {
    try {
      const player = await db.query(
        `SELECT id, nickname, best_score, best_streak, total_games as total_games_played,
                current_coins, current_gems, current_hearts, is_premium,
                heart_booster_expiry, created_at, last_active_at, platform,
                total_coins_earned, total_gems_earned
         FROM players WHERE id = $1`,
        [req.playerId]
      );

      if (player.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      // Get player inventory
      const inventory = await db.query(
        `SELECT item_type, item_id, quantity, equipped, acquired_at, acquired_method
         FROM player_inventory WHERE player_id = $1`,
        [req.playerId]
      );

      // Get daily streak data
      const dailyStreak = await db.query(
        `SELECT current_streak, current_cycle, cycle_reward_set, 
                total_cycles_completed, last_claim_date, cycle_start_date
         FROM daily_streaks WHERE player_id = $1`,
        [req.playerId]
      );

      const playerData = player.rows[0];
      const streakData = dailyStreak.rows.length > 0 ? dailyStreak.rows[0] : {
        current_streak: 0,
        current_cycle: 0,
        cycle_reward_set: 'new_player',
        total_cycles_completed: 0,
        last_claim_date: null,
        cycle_start_date: null
      };

      res.json({
        success: true,
        player: {
          ...playerData,
          heartBoosterActive: playerData.heart_booster_expiry && 
                            new Date(playerData.heart_booster_expiry) > new Date(),
          inventory: inventory.rows,
          // Add daily streak data
          daily_streak: streakData
        }
      });

    } catch (error) {
      logger.error('Profile fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  /// 🏆 Grant starter achievements to new players
  async function grantStarterAchievements(playerId) {
    try {
      // Get all achievements that should be auto-granted
      const starterAchievements = ['first_flight']; // Will be completed on first score

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

  // 🌍 Country detection now handled by GeoIPService

  /// 📊 Get authentication analytics (admin only)
  router.get('/analytics', async (req, res) => {
    try {
      // Simple admin check - in production, use proper admin middleware
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'flappyjet-admin-dev') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const report = authAnalytics.generateReport();
      
      res.json({
        success: true,
        analytics: report
      });

    } catch (error) {
      logger.error('🔐 AUTH ANALYTICS ERROR', error);
      res.status(500).json({ error: 'Failed to get authentication analytics' });
    }
  });

  /// 📊 Get daily authentication summary
  router.get('/daily-summary', async (req, res) => {
    try {
      const dailyStats = authAnalytics.getDailyStats();
      const sessionStats = authAnalytics.getSessionStats();
      
      res.json({
        success: true,
        daily: dailyStats,
        sessions: sessionStats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('🔐 DAILY SUMMARY ERROR', error);
      res.status(500).json({ error: 'Failed to get daily summary' });
    }
  });

  // Export the authenticateToken middleware for use in other routes
  router.authenticateToken = authenticateToken;

  return router;
};
