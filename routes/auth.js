/// 🔐 Authentication Routes - JWT-based player authentication
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const logger = require('../utils/logger');

module.exports = (db) => {
  const router = express.Router();
  
  const JWT_SECRET = process.env.JWT_SECRET || 'flappyjet-dev-secret-change-in-production';
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

  // Validation schemas
  const registerSchema = Joi.object({
    deviceId: Joi.string().required().min(10).max(255),
    nickname: Joi.string().min(1).max(50).default('Pilot'),
    platform: Joi.string().valid('ios', 'android', 'web').default('unknown'),
    appVersion: Joi.string().max(20).default('1.0.0'),
    countryCode: Joi.string().length(2).optional(),
    timezone: Joi.string().max(50).optional()
  });

  const loginSchema = Joi.object({
    deviceId: Joi.string().required().min(10).max(255),
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
    try {
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { deviceId, nickname, platform, appVersion, countryCode, timezone } = value;

      // 🌍 Enhanced country detection: Use client-provided country, fallback to IP-based detection
      let detectedCountry = countryCode;
      
      // Only use IP detection if client didn't provide a country or sent a clearly default value
      // We assume 'US' might be a default/hardcoded value from older app versions
      if (!detectedCountry) {
        // No country provided - try IP detection
        detectedCountry = getCountryFromIP(req) || 'US';
      } else if (countryCode === 'US') {
        // Client sent 'US' - could be real US user or hardcoded default
        // Try IP detection as additional validation, but keep 'US' if IP fails
        const ipCountry = getCountryFromIP(req);
        detectedCountry = ipCountry || 'US';
        
        if (ipCountry && ipCountry !== 'US') {
          console.log(`🌍 IP-based country override: Client sent 'US' but IP suggests '${ipCountry}'`);
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
        `SELECT id, nickname, best_score, best_streak, total_games_played,
                current_coins, current_gems, current_hearts, is_premium,
                heart_booster_expiry, created_at
         FROM players WHERE id = $1`,
        [playerId]
      );

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
      logger.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  /// 🔑 Login existing player
  router.post('/login', async (req, res) => {
    try {
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { deviceId, platform, appVersion } = value;

      // Find player by device ID
      const player = await db.query(
        `SELECT id, nickname, best_score, best_streak, total_games_played,
                current_coins, current_gems, current_hearts, is_premium,
                heart_booster_expiry, created_at, is_banned, ban_reason
         FROM players WHERE device_id = $1`,
        [deviceId]
      );

      if (player.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found. Please register first.' });
      }

      const playerData = player.rows[0];

      // Check if player is banned
      if (playerData.is_banned) {
        return res.status(403).json({ 
          error: 'Account banned', 
          reason: playerData.ban_reason 
        });
      }

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
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  /// 🔄 Refresh token
  router.post('/refresh', authenticateToken, async (req, res) => {
    try {
      // Verify player still exists and is not banned
      const player = await db.query(
        'SELECT id, is_banned FROM players WHERE id = $1',
        [req.playerId]
      );

      if (player.rows.length === 0 || player.rows[0].is_banned) {
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

      res.json({
        success: true,
        token
      });

    } catch (error) {
      logger.error('Token refresh error:', error);
      res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  /// 👤 Get current player profile with inventory
  router.get('/profile', authenticateToken, async (req, res) => {
    try {
      const player = await db.query(
        `SELECT id, nickname, best_score, best_streak, total_games_played,
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

      const playerData = player.rows[0];

      res.json({
        success: true,
        player: {
          ...playerData,
          heartBoosterActive: playerData.heart_booster_expiry && 
                            new Date(playerData.heart_booster_expiry) > new Date(),
          inventory: inventory.rows
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

  /// 🌍 Get country code from IP address
  function getCountryFromIP(req) {
    try {
      // Get real IP address (handle proxies, load balancers)
      const forwarded = req.headers['x-forwarded-for'];
      const ip = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;
      
      // Basic IP-to-country mapping (simplified)
      // In production, you'd use a service like MaxMind GeoIP or ip-api.com
      if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return null; // Local/private IP
      }

      // For now, we'll use a simple heuristic based on common IP ranges
      // This is a basic implementation - consider using a proper GeoIP service
      logger.info(`🌍 Detecting country for IP: ${ip}`);
      
      // You can integrate with services like:
      // - MaxMind GeoIP2
      // - ip-api.com
      // - ipinfo.io
      // For now, return null to use client-provided country
      
      return null;
    } catch (error) {
      logger.error('Error detecting country from IP:', error);
      return null;
    }
  }

  // Export the authenticateToken middleware for use in other routes
  router.authenticateToken = authenticateToken;

  return router;
};
