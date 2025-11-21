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

