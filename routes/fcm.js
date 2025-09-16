/// 🔥 FCM Routes - Firebase Cloud Messaging Token Management
/// Handles FCM token registration and notification preferences

const express = require('express');
const { body, validationResult } = require('express-validator');
const FCMService = require('../services/fcm-service');
const logger = require('../utils/logger');

// Export function that takes db parameter (consistent with other routes)
module.exports = (db) => {
  const router = express.Router();

  // Middleware to add db to request
  router.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Middleware to authenticate JWT tokens
  const authenticateToken = require('../middleware/auth');

/**
 * Register FCM token for push notifications
 * POST /api/fcm/register-token
 */
router.post('/register-token', [
  authenticateToken,
  body('fcmToken').isString().isLength({ min: 100 }).withMessage('Invalid FCM token'),
  body('platform').isIn(['android', 'ios']).withMessage('Platform must be android or ios'),
  body('timezone').optional().isString().withMessage('Timezone must be a string'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { fcmToken, platform, timezone } = req.body;
    const playerId = req.user.playerId;

    // Only register Android tokens (iOS uses local notifications)
    if (platform !== 'android') {
      return res.json({
        success: true,
        message: 'iOS uses local notifications, token not stored'
      });
    }

    // Validate FCM token format
    const fcmService = new FCMService();
    if (!fcmService.isValidToken(fcmToken)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid FCM token format'
      });
    }

    // Store FCM token in database
    await req.db.query(`
      INSERT INTO fcm_tokens (player_id, token, platform, timezone, created_at, updated_at) 
      VALUES ($1, $2, $3, $4, NOW(), NOW()) 
      ON CONFLICT (player_id) 
      DO UPDATE SET 
        token = EXCLUDED.token,
        timezone = EXCLUDED.timezone,
        updated_at = NOW()
    `, [playerId, fcmToken, platform, timezone || 'UTC']);

    // Update player timezone if provided
    if (timezone) {
      await req.db.query(`
        UPDATE players 
        SET timezone = $1, updated_at = NOW() 
        WHERE id = $2
      `, [timezone, playerId]);
    }

    logger.info(`🔥 FCM token registered for player ${playerId} (${platform})`);

    res.json({
      success: true,
      message: 'FCM token registered successfully',
      platform,
      timezone: timezone || 'UTC'
    });

  } catch (error) {
    logger.error('🔥 Error registering FCM token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register FCM token'
    });
  }
});

/**
 * Update notification preferences
 * PUT /api/fcm/preferences
 */
router.put('/preferences', [
  authenticateToken,
  body('hearts').optional().isBoolean().withMessage('Hearts preference must be boolean'),
  body('streak').optional().isBoolean().withMessage('Streak preference must be boolean'),
  body('engagement').optional().isBoolean().withMessage('Engagement preference must be boolean'),
  body('tournaments').optional().isBoolean().withMessage('Tournaments preference must be boolean'),
  body('achievements').optional().isBoolean().withMessage('Achievements preference must be boolean'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const playerId = req.user.playerId;
    const preferences = {};

    // Build preferences object from request body
    ['hearts', 'streak', 'engagement', 'tournaments', 'achievements'].forEach(key => {
      if (req.body[key] !== undefined) {
        preferences[key] = req.body[key];
      }
    });

    if (Object.keys(preferences).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No preferences provided'
      });
    }

    // Update notification preferences
    await req.db.query(`
      UPDATE players 
      SET notification_preferences = notification_preferences || $1,
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(preferences), playerId]);

    logger.info(`🔥 Notification preferences updated for player ${playerId}:`, preferences);

    res.json({
      success: true,
      message: 'Notification preferences updated',
      preferences
    });

  } catch (error) {
    logger.error('🔥 Error updating notification preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notification preferences'
    });
  }
});

/**
 * Get current notification preferences
 * GET /api/fcm/preferences
 */
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;

    const result = await req.db.query(`
      SELECT notification_preferences, timezone 
      FROM players 
      WHERE id = $1
    `, [playerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Player not found'
      });
    }

    const player = result.rows[0];
    const preferences = player.notification_preferences || {
      hearts: true,
      streak: true,
      engagement: true,
      tournaments: true,
      achievements: true
    };

    res.json({
      success: true,
      preferences,
      timezone: player.timezone || 'UTC'
    });

  } catch (error) {
    logger.error('🔥 Error fetching notification preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification preferences'
    });
  }
});

/**
 * Unregister FCM token (when user logs out or uninstalls)
 * DELETE /api/fcm/token
 */
router.delete('/token', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;

    await req.db.query(`
      DELETE FROM fcm_tokens 
      WHERE player_id = $1
    `, [playerId]);

    logger.info(`🔥 FCM token unregistered for player ${playerId}`);

    res.json({
      success: true,
      message: 'FCM token unregistered successfully'
    });

  } catch (error) {
    logger.error('🔥 Error unregistering FCM token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unregister FCM token'
    });
  }
});

/**
 * Send test notification (for debugging)
 * POST /api/fcm/test-notification
 */
router.post('/test-notification', [
  authenticateToken,
  body('title').isString().isLength({ min: 1, max: 100 }).withMessage('Title required (1-100 chars)'),
  body('body').isString().isLength({ min: 1, max: 200 }).withMessage('Body required (1-200 chars)'),
], async (req, res) => {
  try {
    // Only allow in development/staging
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: 'Test notifications not allowed in production'
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const playerId = req.user.playerId;
    const { title, body } = req.body;

    // Get player's FCM token
    const tokenResult = await req.db.query(`
      SELECT token, timezone 
      FROM fcm_tokens 
      WHERE player_id = $1 AND platform = 'android'
    `, [playerId]);

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No FCM token found for this player'
      });
    }

    const { token, timezone } = tokenResult.rows[0];
    const fcmService = new FCMService();

    const result = await fcmService.sendSmartNotification(
      token,
      title,
      body,
      { type: 'test', player_id: playerId },
      timezone || 'UTC',
      { ignoreTimezone: true } // Send immediately for testing
    );

    res.json({
      success: result.success,
      message: result.success ? 'Test notification sent' : 'Failed to send notification',
      details: result
    });

  } catch (error) {
    logger.error('🔥 Error sending test notification:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification'
    });
  }
});

/**
 * Get FCM service statistics (admin only)
 * GET /api/fcm/stats
 */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin (implement your admin check logic)
    // For now, just return basic stats

    const fcmService = new FCMService();
    const stats = fcmService.getStats();

    // Get token counts from database
    const tokenStats = await req.db.query(`
      SELECT 
        platform,
        COUNT(*) as count,
        COUNT(CASE WHEN updated_at > NOW() - INTERVAL '7 days' THEN 1 END) as active_last_week
      FROM fcm_tokens 
      GROUP BY platform
    `);

    res.json({
      success: true,
      fcm_service: stats,
      token_stats: tokenStats.rows,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('🔥 Error fetching FCM stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch FCM statistics'
    });
  }
});

  return router;
};
