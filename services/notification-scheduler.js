/**
 * Notification Scheduler Service
 * Automatically sends push notifications at 1h, 24h, and 46h after user closes app
 * 
 * Features:
 * - Detects inactive users
 * - Respects quiet hours (10 PM - 8 AM user local time)
 * - Enforces daily notification limit (max 3 per day)
 * - Personalizes messages (nickname, level, streak)
 * - Uses message variants (friendly, casual, professional)
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const NotificationMessages = require('./notification-messages');

class NotificationScheduler {
  constructor({ db, firebaseMessagingService, fcmTokenManager, notificationTracker }) {
    this.db = db;
    this.firebaseMessagingService = firebaseMessagingService;
    this.fcmTokenManager = fcmTokenManager;
    this.notificationTracker = notificationTracker;
    this.messageService = new NotificationMessages();
    this.scheduledJobs = new Map();
    this.isRunning = false;
  }

  /**
   * Start the notification scheduler
   */
  start() {
    if (this.isRunning) {
      logger.info('🔔 Notification scheduler already running');
      return;
    }

    logger.info('🔔 Starting notification scheduler...');

    // Initialize Firebase if needed
    this.firebaseMessagingService.initialize().catch(err => {
      logger.error('🔔 Failed to initialize Firebase for scheduler:', err);
    });

    // Schedule notification checks every 15 minutes
    // This checks for users who need 1h, 24h, or 46h notifications
    this.scheduledJobs.set('check_notifications', cron.schedule('*/15 * * * *', async () => {
      await this._checkAndSendNotifications();
    }, {
      scheduled: true,
      timezone: 'UTC'
    }));

    this.isRunning = true;
    logger.info('🔔 ✅ Notification scheduler started');
  }

  /**
   * Stop the notification scheduler
   */
  stop() {
    if (!this.isRunning) {
      logger.info('🔔 Notification scheduler not running');
      return;
    }

    logger.info('🔔 Stopping notification scheduler...');

    for (const [name, job] of this.scheduledJobs) {
      if (job && typeof job.stop === 'function') {
        job.stop();
        logger.info(`🔔 ⏹️ Stopped job: ${name}`);
      }
    }

    this.scheduledJobs.clear();
    this.isRunning = false;
    logger.info('🔔 ✅ Notification scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.scheduledJobs.keys()),
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Main method: Check for users who need notifications and send them
   */
  async _checkAndSendNotifications() {
    try {
      logger.info('🔔 Checking for users who need notifications...');

      // Check for each notification type
      await Promise.all([
        this._sendNotificationsForType('1hour', 1),
        this._sendNotificationsForType('24hour', 24),
        this._sendNotificationsForType('46hour', 46),
      ]);

      logger.info('🔔 ✅ Notification check completed');
    } catch (error) {
      logger.error('🔔 ❌ Error checking notifications:', error);
    }
  }

  /**
   * Send notifications for a specific type (1hour, 24hour, 46hour)
   * 
   * @param {string} notificationType - '1hour', '24hour', or '46hour'
   * @param {number} hoursInactive - Hours since user was last active
   */
  async _sendNotificationsForType(notificationType, hoursInactive) {
    try {
      // Find users who:
      // 1. Have an active FCM token
      // 2. Were last active X hours ago (with 15-minute window)
      // 3. Haven't received this notification type yet today
      // 4. Are not in quiet hours
      // 5. Haven't hit daily limit
      const users = await this._findUsersForNotification(notificationType, hoursInactive);

      if (users.length === 0) {
        logger.info(`🔔 No users found for ${notificationType} notification`);
        return;
      }

      logger.info(`🔔 Found ${users.length} users for ${notificationType} notification`);

      // Send notifications in batches
      const batchSize = 50; // Process 50 at a time to avoid overwhelming FCM
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await this._sendBatchNotifications(batch, notificationType);
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < users.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      logger.info(`🔔 ✅ Sent ${notificationType} notifications to ${users.length} users`);
    } catch (error) {
      logger.error(`🔔 ❌ Error sending ${notificationType} notifications:`, error);
    }
  }

  /**
   * Find users who should receive a notification
   * 
   * @param {string} notificationType - '1hour', '24hour', or '46hour'
   * @param {number} hoursInactive - Hours since last activity
   * @returns {Promise<Array>} - Array of user objects with FCM tokens
   */
  async _findUsersForNotification(notificationType, hoursInactive) {
    try {
      const windowStart = hoursInactive - 0.25; // 15 minutes before
      const windowEnd = hoursInactive + 0.25;   // 15 minutes after

      // Use parameterized query with proper interval calculation
      const query = `
        WITH user_last_activity AS (
          -- Get last activity time per user (from events table)
          SELECT 
            user_id,
            MAX(received_at) as last_activity
          FROM events
          WHERE event_type IN ('app_launched', 'game_started', 'level_started')
          GROUP BY user_id
        ),
        eligible_users AS (
          -- Find users who were active X hours ago (within 15-min window)
          SELECT DISTINCT
            ft.user_id,
            ft.fcm_token,
            ft.country,
            ft.timezone,
            ula.last_activity
          FROM fcm_tokens ft
          INNER JOIN user_last_activity ula ON ft.user_id = ula.user_id
          WHERE ft.is_active = true
            AND ft.platform = 'android'
            -- Last activity was X hours ago (within 15-min window)
            AND ula.last_activity <= NOW() - ($2::text || ' hours')::INTERVAL
            AND ula.last_activity >= NOW() - ($3::text || ' hours')::INTERVAL
            -- User hasn't received this notification type today
            AND NOT EXISTS (
              SELECT 1
              FROM notification_events ne
              WHERE ne.user_id = ft.user_id
                AND ne.notification_type = $1
                AND ne.event_type = 'sent'
                AND ne.received_at >= CURRENT_DATE
            )
            -- User hasn't hit daily limit
            AND check_daily_notification_limit(ft.user_id) = true
            -- User is not in quiet hours (if timezone available)
            AND (
              ft.timezone IS NULL 
              OR is_in_quiet_hours(ft.user_id, ft.timezone) = false
            )
        )
        SELECT * FROM eligible_users
        LIMIT 500
      `;

      const result = await this.db.query(query, [
        notificationType,
        windowStart,
        windowEnd,
      ]);
      return result.rows;
    } catch (error) {
      logger.error('🔔 ❌ Error finding users for notification:', error);
      return [];
    }
  }

  /**
   * Get user context for personalization
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - User context (nickname, lastLevel, streak, gamesPlayed)
   */
  async _getUserContext(userId) {
    try {
      const result = await this.db.query(`
        WITH user_metadata AS (
          -- Get latest user profile data
          SELECT DISTINCT ON (user_id)
            user_id,
            COALESCE(payload->>'nickname', 'Player') as nickname,
            COALESCE((payload->>'currentLevel')::int, (payload->>'level')::int, 1) as last_level,
            COALESCE((payload->>'currentStreak')::int, (payload->>'streak')::int, 0) as current_streak
          FROM events
          WHERE user_id = $1
            AND event_type IN ('app_launched', 'user_installed', 'level_started', 'level_completed')
          ORDER BY user_id, received_at DESC
        ),
        user_game_count AS (
          -- Count total games played
          SELECT 
            user_id,
            COUNT(*) as games_played
          FROM events
          WHERE user_id = $1
            AND event_type = 'game_started'
          GROUP BY user_id
        )
        SELECT 
          COALESCE(um.nickname, 'Player') as nickname,
          COALESCE(um.last_level, 1) as last_level,
          COALESCE(um.current_streak, 0) as current_streak,
          COALESCE(ugc.games_played, 0) as games_played
        FROM user_metadata um
        LEFT JOIN user_game_count ugc ON um.user_id = ugc.user_id
        LIMIT 1
      `, [userId]);

      if (result.rows.length === 0) {
        return {
          nickname: 'Player',
          lastLevel: 1,
          currentStreak: 0,
          gamesPlayed: 0,
        };
      }

      const row = result.rows[0];
      return {
        nickname: row.nickname || 'Player',
        lastLevel: parseInt(row.last_level) || 1,
        currentStreak: parseInt(row.current_streak) || 0,
        gamesPlayed: parseInt(row.games_played) || 0,
      };
    } catch (error) {
      logger.error('🔔 ❌ Error getting user context:', error);
      return {
        nickname: 'Player',
        lastLevel: 1,
        currentStreak: 0,
        gamesPlayed: 0,
      };
    }
  }

  /**
   * Send notifications to a batch of users
   * 
   * @param {Array} users - Array of user objects
   * @param {string} notificationType - '1hour', '24hour', or '46hour'
   */
  async _sendBatchNotifications(users, notificationType) {
    const notifications = [];

    for (const user of users) {
      try {
        // Get user context for personalization
        const userContext = await this._getUserContext(user.user_id);

        // Get message template (random variant)
        const message = this.messageService.getMessage(notificationType, userContext);

        // Determine reward (coins or gems)
        const reward = this._getRewardForNotification(notificationType);

        // Build FCM data payload
        const data = {
          type: notificationType,
          userId: user.user_id,
          notification_type: notificationType,
          reward_type: reward.type,
          reward_amount: reward.amount.toString(),
          timestamp: new Date().toISOString(),
        };

        notifications.push({
          token: user.fcm_token,
          title: message.title,
          body: message.body,
          data,
          channelId: 'retention_notifications',
          userId: user.user_id,
          notificationType,
          messageVariant: message.variant,
          rewardType: reward.type,
          rewardAmount: reward.amount,
          userContext,
        });
      } catch (error) {
        logger.error(`🔔 ❌ Error preparing notification for user ${user.user_id}:`, error);
      }
    }

    // Send notifications individually to track each one properly
    // (FCM batch doesn't return per-message results in our current implementation)
    let successCount = 0;
    let failCount = 0;

    for (const notif of notifications) {
      try {
        const sendResult = await this.firebaseMessagingService.sendNotification(notif.token, {
          title: notif.title,
          body: notif.body,
          data: notif.data,
          channelId: notif.channelId,
        });

        if (sendResult.success) {
          // Record sent event
          await this.notificationTracker.markSent(notif.userId, notif.notificationType, {
            title: notif.title,
            body: notif.body,
            messageVariant: notif.messageVariant,
            sentVia: 'fcm',
            rewardType: notif.rewardType,
            rewardAmount: notif.rewardAmount,
            metadata: {
              fcmResponse: { messageId: sendResult.messageId },
              userContext: notif.userContext,
            },
          });

          // Update token last sent timestamp (expects just the token string)
          await this.fcmTokenManager.updateLastNotificationSent(notif.token);

          successCount++;
        } else {
          // Handle failure
          if (sendResult.isInvalidToken) {
            // Deactivate invalid token (expects just the token string)
            await this.fcmTokenManager.deactivateToken(notif.token);
          }

          // Track failed event
          await this.notificationTracker.markFailed(
            notif.userId,
            notif.notificationType,
            sendResult.error || 'Unknown error',
            {
              title: notif.title,
              body: notif.body,
              messageVariant: notif.messageVariant,
              sentVia: 'fcm',
            }
          );

          failCount++;
        }

        // Small delay between sends to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        logger.error(`🔔 ❌ Error sending notification to user ${notif.userId}:`, error);
        failCount++;
      }
    }

    logger.info(`🔔 📤 Batch complete: ${successCount} successful, ${failCount} failed`);
  }

  /**
   * Get reward for notification type
   * 
   * @param {string} notificationType - '1hour', '24hour', or '46hour'
   * @returns {Object} - { type: 'coins'|'gems', amount: number }
   */
  _getRewardForNotification(notificationType) {
    // Smart distribution: Mix of coins and gems
    // 1hour: 50 coins (70%) or 5 gems (30%)
    // 24hour: 100 coins (60%) or 5 gems (40%)
    // 46hour: 200 coins (50%) or 10 gems (50%) - more valuable for win-back
    const random = Math.random();

    switch (notificationType) {
      case '1hour':
        return random < 0.7 ? { type: 'coins', amount: 50 } : { type: 'gems', amount: 5 };
      case '24hour':
        return random < 0.6 ? { type: 'coins', amount: 100 } : { type: 'gems', amount: 5 };
      case '46hour':
        return random < 0.5 ? { type: 'coins', amount: 200 } : { type: 'gems', amount: 10 };
      default:
        return { type: 'coins', amount: 100 };
    }
  }
}

module.exports = NotificationScheduler;

