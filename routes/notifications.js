/**
 * Push Notification API Routes
 * 
 * Endpoints:
 * - POST /api/notifications/register-token - Register FCM token
 * - POST /api/notifications/clicked - Track notification click
 * - POST /api/notifications/claimed - Mark reward as claimed
 * - POST /api/notifications/test-send - Send immediate test notification (for testing)
 * - GET /api/notifications/history - Get user notification history
 * - GET /api/notifications/stats - Get notification statistics (admin)
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

module.exports = (db) => {
  const FCMTokenManager = require('../services/fcm-token-manager');
  const NotificationTracker = require('../services/notification-tracker');
  const firebaseMessagingService = require('../services/firebase-messaging-service');

  const fcmTokenManager = new FCMTokenManager(db);
  const notificationTracker = new NotificationTracker(db);

  /**
   * Register or update FCM token
   * 
   * POST /api/notifications/register-token
   * Body: {
   *   userId: string,
   *   fcmToken: string,
   *   platform: 'android' | 'ios',
   *   country?: string,
   *   timezone?: string,
   *   deviceModel?: string,
   *   osVersion?: string,
   *   appVersion?: string
   * }
   */
  router.post('/register-token', async (req, res) => {
    try {
      const {
        userId,
        fcmToken,
        platform = 'android',
        country,
        timezone,
        deviceModel,
        osVersion,
        appVersion,
      } = req.body;

      // Validate required fields
      if (!userId || !fcmToken) {
        return res.status(400).json({
          success: false,
          error: 'userId and fcmToken are required',
        });
      }

      // Validate token format
      if (!firebaseMessagingService.isValidTokenFormat(fcmToken)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid FCM token format',
        });
      }

      // Register token
      const result = await fcmTokenManager.registerToken({
        userId,
        fcmToken,
        platform,
        country,
        timezone,
        deviceModel,
        osVersion,
        appVersion,
      });

      logger.info('✅ FCM token registered via API', {
        userId,
        platform,
        tokenId: result.tokenId,
      });

      res.json({
        success: true,
        tokenId: result.tokenId,
      });
    } catch (error) {
      logger.error('❌ Failed to register FCM token', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to register token',
      });
    }
  });

  /**
   * Find user by nickname
   * 
   * GET /api/notifications/find-user?nickname=xxx
   * Returns user info including FCM token status
   */
  router.get('/find-user', async (req, res) => {
    try {
      const { nickname } = req.query;

      if (!nickname) {
        return res.status(400).json({
          success: false,
          error: 'nickname query parameter is required',
        });
      }

      // Find user by nickname from events (most recent)
      const userResult = await db.query(`
        SELECT DISTINCT ON (user_id)
          user_id,
          payload->>'nickname' as nickname,
          MAX(received_at) as last_seen
        FROM events
        WHERE payload->>'nickname' = $1
           OR payload->>'nickname' ILIKE $1
        GROUP BY user_id, payload->>'nickname'
        ORDER BY user_id, MAX(received_at) DESC
        LIMIT 10
      `, [nickname]);

      if (userResult.rows.length === 0) {
        return res.json({
          success: true,
          found: false,
          message: 'No user found with this nickname',
        });
      }

      // Get FCM token info for each user
      const usersWithFCM = await Promise.all(
        userResult.rows.map(async (user) => {
          const fcmToken = await fcmTokenManager.getActiveToken(user.user_id);
          const tokenInfo = fcmToken ? await db.query(
            'SELECT * FROM fcm_tokens WHERE user_id = $1 AND is_active = true',
            [user.user_id]
          ) : { rows: [] };

          // Get last activity
          const lastActivity = await db.query(`
            SELECT 
              MAX(received_at) as last_activity,
              NOW() - MAX(received_at) as hours_inactive
            FROM events
            WHERE user_id = $1
              AND event_type IN ('app_launched', 'game_started', 'level_started')
          `, [user.user_id]);

          return {
            user_id: user.user_id,
            nickname: user.nickname,
            last_seen: user.last_seen,
            fcm_token: {
              registered: !!fcmToken,
              token_preview: fcmToken ? fcmToken.substring(0, 30) + '...' : null,
              platform: tokenInfo.rows[0]?.platform || null,
              timezone: tokenInfo.rows[0]?.timezone || null,
              is_active: tokenInfo.rows[0]?.is_active || false,
              last_notification_sent: tokenInfo.rows[0]?.last_notification_sent || null,
            },
            activity: {
              last_activity: lastActivity.rows[0]?.last_activity || null,
              hours_inactive: lastActivity.rows[0]?.hours_inactive 
                ? parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) 
                : null,
            },
          };
        })
      );

      res.json({
        success: true,
        found: true,
        count: usersWithFCM.length,
        users: usersWithFCM,
      });
    } catch (error) {
      logger.error('❌ Failed to find user by nickname', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Diagnostic endpoint - Check user notification status
   * 
   * GET /api/notifications/diagnose?userId=xxx
   * Returns detailed status about user's notification eligibility
   */
  router.get('/diagnose', async (req, res) => {
    try {
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId query parameter is required',
        });
      }

      // Check FCM token
      const fcmToken = await fcmTokenManager.getActiveToken(userId);
      const tokenInfo = fcmToken ? await db.query(
        'SELECT * FROM fcm_tokens WHERE user_id = $1 AND is_active = true',
        [userId]
      ) : { rows: [] };

      // Check last activity
      const lastActivity = await db.query(`
        SELECT 
          MAX(received_at) as last_activity,
          NOW() - MAX(received_at) as hours_inactive
        FROM events
        WHERE user_id = $1
          AND event_type IN ('app_launched', 'game_started', 'level_started')
      `, [userId]);

      // Check notification events today
      const notificationsToday = await db.query(`
        SELECT 
          notification_type,
          event_type,
          COUNT(*) as count
        FROM notification_events
        WHERE user_id = $1
          AND received_at >= CURRENT_DATE
        GROUP BY notification_type, event_type
      `, [userId]);

      // Check daily limit
      const dailyLimitCheck = await db.query(
        'SELECT check_daily_notification_limit($1) as can_receive',
        [userId]
      );

      // Check quiet hours (if timezone available)
      let quietHoursCheck = { rows: [{ is_quiet: null }] };
      if (tokenInfo.rows[0]?.timezone) {
        quietHoursCheck = await db.query(
          'SELECT is_in_quiet_hours($1, $2) as is_quiet',
          [userId, tokenInfo.rows[0].timezone]
        );
      }

      res.json({
        success: true,
        userId,
        fcm_token: {
          registered: !!fcmToken,
          token: fcmToken ? fcmToken.substring(0, 20) + '...' : null,
          platform: tokenInfo.rows[0]?.platform || null,
          timezone: tokenInfo.rows[0]?.timezone || null,
          last_sent: tokenInfo.rows[0]?.last_notification_sent || null,
        },
        activity: {
          last_activity: lastActivity.rows[0]?.last_activity || null,
          hours_inactive: lastActivity.rows[0]?.hours_inactive 
            ? parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) 
            : null,
        },
        eligibility: {
          can_receive_1hour: lastActivity.rows[0]?.hours_inactive 
            ? parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) >= 0.75 
              && parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) <= 1.25
            : false,
          can_receive_24hour: lastActivity.rows[0]?.hours_inactive 
            ? parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) >= 23.75 
              && parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) <= 24.25
            : false,
          can_receive_46hour: lastActivity.rows[0]?.hours_inactive 
            ? parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) >= 45.75 
              && parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) <= 46.25
            : false,
          within_daily_limit: dailyLimitCheck.rows[0]?.can_receive || false,
          not_in_quiet_hours: !quietHoursCheck.rows[0]?.is_quiet,
        },
        notifications_today: notificationsToday.rows,
        recommendations: {
          needs_fcm_token: !fcmToken,
          needs_inactivity: lastActivity.rows[0]?.hours_inactive 
            ? parseFloat(lastActivity.rows[0].hours_inactive.split(' ')[0]) < 0.75
            : true,
          in_quiet_hours: quietHoursCheck.rows[0]?.is_quiet || false,
        },
      });
    } catch (error) {
      logger.error('❌ Failed to diagnose user notification status', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Track notification click
   * 
   * POST /api/notifications/clicked
   * Body: {
   *   userId: string,
   *   notificationType: '1hour' | '24hour' | '46hour'
   * }
   */
  router.post('/clicked', async (req, res) => {
    try {
      const { userId, notificationType } = req.body;

      if (!userId || !notificationType) {
        return res.status(400).json({
          success: false,
          error: 'userId and notificationType are required',
        });
      }

      // Record click event
      const eventId = await notificationTracker.markClicked(userId, notificationType);

      // Update token metadata
      await fcmTokenManager.updateLastNotificationClicked(userId);

      logger.info('📲 Notification clicked', {
        userId,
        notificationType,
        eventId,
      });

      res.json({
        success: true,
        eventId,
      });
    } catch (error) {
      logger.error('❌ Failed to track notification click', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to track click',
      });
    }
  });

  /**
   * Mark notification reward as claimed
   * 
   * POST /api/notifications/claimed
   * Body: {
   *   eventId: number
   * }
   */
  router.post('/claimed', async (req, res) => {
    try {
      const { eventId } = req.body;

      if (!eventId) {
        return res.status(400).json({
          success: false,
          error: 'eventId is required',
        });
      }

      const success = await notificationTracker.markRewardClaimed(eventId);

      res.json({
        success,
      });
    } catch (error) {
      logger.error('❌ Failed to mark reward claimed', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to mark reward claimed',
      });
    }
  });

  /**
   * Send immediate test notification (for testing)
   * 
   * POST /api/notifications/test-send
   * Body: {
   *   userId: string,
   *   title?: string,
   *   body?: string,
   *   reward_type?: 'coins' | 'gems',
   *   reward_amount?: number
   * }
   */
  router.post('/test-send', async (req, res) => {
    try {
      const {
        userId,
        title = '🎮 Test Notification',
        body = 'This is a test push notification from FlappyJet!',
        reward_type,
        reward_amount,
      } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required',
        });
      }

      // Get active FCM token for user
      const fcmToken = await fcmTokenManager.getActiveToken(userId);

      if (!fcmToken) {
        return res.status(404).json({
          success: false,
          error: 'No active FCM token found for user',
        });
      }

      // Initialize Firebase if needed
      await firebaseMessagingService.initialize();

      // Build FCM data payload
      const fcmData = {
        type: 'test',
        userId,
        timestamp: new Date().toISOString(),
      };

      // Include reward data if provided
      if (reward_type && reward_amount) {
        fcmData.reward_type = reward_type;
        fcmData.reward_amount = reward_amount.toString();
      }

      // Send notification
      const sendResult = await firebaseMessagingService.sendNotification(fcmToken, {
        title,
        body,
        data: fcmData,
        channelId: 'retention_notifications',
      });

      if (sendResult.success) {
        // Record event
        await notificationTracker.markSent(userId, 'custom', {
          title,
          body,
          messageVariant: 'test',
          sentVia: 'fcm',
          rewardType: reward_type || 'none',
          rewardAmount: reward_amount || 0,
          metadata: {
            fcmResponse: sendResult,
          },
        });

        await fcmTokenManager.updateLastNotificationSent(fcmToken);

        logger.info('✅ Test notification sent', {
          userId,
          messageId: sendResult.messageId,
        });

        res.json({
          success: true,
          messageId: sendResult.messageId,
          title,
          body,
        });
      } else {
        // Handle failure
        if (sendResult.isInvalidToken) {
          await fcmTokenManager.deactivateToken(fcmToken);
        }

        await notificationTracker.markFailed(userId, 'custom', sendResult.error, {
          title,
          body,
          messageVariant: 'test',
          sentVia: 'fcm',
        });

        res.status(500).json({
          success: false,
          error: sendResult.error,
        });
      }
    } catch (error) {
      logger.error('❌ Failed to send test notification', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get user notification history
   * 
   * GET /api/notifications/history?userId=xxx&limit=20
   */
  router.get('/history', async (req, res) => {
    try {
      const { userId, limit = 20 } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required',
        });
      }

      const history = await notificationTracker.getUserHistory(userId, parseInt(limit));

      res.json({
        success: true,
        history,
      });
    } catch (error) {
      logger.error('❌ Failed to get notification history', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get notification history',
      });
    }
  });

  /**
   * Get notification statistics (admin)
   * 
   * GET /api/notifications/stats
   */
  router.get('/stats', async (req, res) => {
    try {
      const [todayStats, tokenStats, countryStats, trend] = await Promise.all([
        notificationTracker.getTodayStats(),
        fcmTokenManager.getTokenStats(),
        notificationTracker.getStatsByCountry(),
        notificationTracker.getNotificationTrend(),
      ]);

      res.json({
        success: true,
        today: todayStats,
        tokens: tokenStats,
        byCountry: countryStats,
        trend,
      });
    } catch (error) {
      logger.error('❌ Failed to get notification stats', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get stats',
      });
    }
  });

  return router;
};

