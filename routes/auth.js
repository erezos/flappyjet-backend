/**
 * 🔐 Authentication Routes
 * 
 * Lightweight auth endpoints for client-only app
 * - No passwords, no sessions
 * - Device-based identification
 * - Used for FCM token registration and user tracking
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

module.exports = (db) => {
  /**
   * POST /api/auth/register
   * Register a new user (device)
   * 
   * Body:
   * - userId: string (device-generated ID)
   * - nickname: string (optional)
   * - country: string (optional)
   * - deviceModel: string (optional)
   * - osVersion: string (optional)
   * - appVersion: string (optional)
   */
  router.post('/register', async (req, res) => {
    const startTime = Date.now();
    
    try {
      const {
        userId,
        nickname,
        country,
        deviceModel,
        osVersion,
        appVersion,
      } = req.body;

      // Validate required field
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required',
        });
      }

      // Check if user already exists
      const existingUser = await db.query(
        'SELECT user_id FROM users WHERE user_id = $1',
        [userId]
      );

      if (existingUser.rows.length > 0) {
        // User exists, just return success (idempotent)
        logger.info({
          service: 'auth',
          action: 'register',
          userId,
          result: 'user_exists',
          responseTime: Date.now() - startTime,
        });

        return res.json({
          success: true,
          message: 'User already registered',
          userId,
          isNew: false,
        });
      }

      // Create new user
      await db.query(
        `INSERT INTO users (
          user_id, nickname, country, device_model, os_version, app_version, created_at, last_seen
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          last_seen = NOW(),
          nickname = COALESCE(EXCLUDED.nickname, users.nickname),
          country = COALESCE(EXCLUDED.country, users.country)`,
        [userId, nickname || 'Player', country, deviceModel, osVersion, appVersion]
      );

      logger.info({
        service: 'auth',
        action: 'register',
        userId,
        country,
        result: 'success',
        responseTime: Date.now() - startTime,
      });

      res.json({
        success: true,
        message: 'User registered successfully',
        userId,
        isNew: true,
      });
    } catch (error) {
      logger.error({
        service: 'auth',
        action: 'register',
        error: error.message,
        stack: error.stack,
        responseTime: Date.now() - startTime,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to register user',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/auth/login
   * Login (verify user exists and update last_seen)
   * 
   * Body:
   * - userId: string (device-generated ID)
   */
  router.post('/login', async (req, res) => {
    const startTime = Date.now();
    
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required',
        });
      }

      // Check if user exists
      const result = await db.query(
        `SELECT user_id, nickname, country, created_at, last_seen 
         FROM users 
         WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        // User doesn't exist - client should call /register
        logger.info({
          service: 'auth',
          action: 'login',
          userId,
          result: 'user_not_found',
          responseTime: Date.now() - startTime,
        });

        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: 'Please register first',
        });
      }

      const user = result.rows[0];

      // Update last_seen
      await db.query(
        'UPDATE users SET last_seen = NOW() WHERE user_id = $1',
        [userId]
      );

      logger.info({
        service: 'auth',
        action: 'login',
        userId,
        result: 'success',
        responseTime: Date.now() - startTime,
      });

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          userId: user.user_id,
          nickname: user.nickname,
          country: user.country,
          createdAt: user.created_at,
          lastSeen: user.last_seen,
        },
      });
    } catch (error) {
      logger.error({
        service: 'auth',
        action: 'login',
        error: error.message,
        stack: error.stack,
        responseTime: Date.now() - startTime,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to login',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/auth/health
   * Health check endpoint
   */
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      service: 'auth',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
};

