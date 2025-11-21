/**
 * Notification Tracker
 * Tracks notification events (scheduled, sent, clicked, dismissed, failed)
 * 
 * Features:
 * - Record notification events
 * - Track delivery and click-through rates
 * - Support analytics queries
 * - Store notification metadata (message, reward, etc.)
 */

const logger = require('../utils/logger');

class NotificationTracker {
  constructor(db) {
    this.db = db;
  }

  /**
   * Record a notification event
   * 
   * @param {Object} eventData - Event data
   * @param {string} eventData.userId - User ID
   * @param {string} eventData.notificationType - Type (1hour, 24hour, 46hour, custom)
   * @param {string} eventData.eventType - Event (scheduled, sent, clicked, dismissed, failed)
   * @param {string} eventData.title - Notification title
   * @param {string} eventData.body - Notification body
   * @param {string} eventData.messageVariant - Message variant (friendly, casual, professional)
   * @param {string} eventData.sentVia - Delivery method (local, fcm, both)
   * @param {string} eventData.rewardType - Reward type (coins, gems, none)
   * @param {number} eventData.rewardAmount - Reward amount
   * @param {Object} eventData.metadata - Additional metadata
   * @returns {Promise<number>} - Event ID
   */
  async recordEvent(eventData) {
    try {
      const {
        userId,
        notificationType,
        eventType,
        title,
        body,
        messageVariant,
        sentVia,
        rewardType = 'none',
        rewardAmount = 0,
        metadata = {},
      } = eventData;

      const result = await this.db.query(
        `INSERT INTO notification_events (
          user_id, notification_type, event_type,
          title, body, message_variant, sent_via,
          reward_type, reward_amount, reward_claimed,
          last_level_played, current_streak, games_played_count,
          country, timezone,
          scheduled_for, sent_at, clicked_at,
          payload, error_message, fcm_response,
          received_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
        RETURNING id`,
        [
          userId,
          notificationType,
          eventType,
          title,
          body,
          messageVariant,
          sentVia,
          rewardType,
          rewardAmount,
          false, // reward_claimed
          metadata.lastLevelPlayed || null,
          metadata.currentStreak || null,
          metadata.gamesPlayedCount || null,
          metadata.country || null,
          metadata.timezone || null,
          metadata.scheduledFor || null,
          eventType === 'sent' ? new Date() : null,
          eventType === 'clicked' ? new Date() : null,
          JSON.stringify(metadata),
          metadata.errorMessage || null,
          metadata.fcmResponse ? JSON.stringify(metadata.fcmResponse) : null,
        ]
      );

      return result.rows[0].id;
    } catch (error) {
      logger.error('❌ Failed to record notification event', {
        userId: eventData.userId,
        eventType: eventData.eventType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mark notification as scheduled
   * 
   * @param {string} userId - User ID
   * @param {string} notificationType - Type (1hour, 24hour, 46hour)
   * @param {Date} scheduledFor - Scheduled time
   * @param {Object} notificationData - Notification details
   * @returns {Promise<number>} - Event ID
   */
  async markScheduled(userId, notificationType, scheduledFor, notificationData) {
    return this.recordEvent({
      userId,
      notificationType,
      eventType: 'scheduled',
      title: notificationData.title,
      body: notificationData.body,
      messageVariant: notificationData.messageVariant,
      sentVia: notificationData.sentVia || 'local',
      rewardType: notificationData.rewardType || 'none',
      rewardAmount: notificationData.rewardAmount || 0,
      metadata: {
        scheduledFor,
        ...notificationData.metadata,
      },
    });
  }

  /**
   * Mark notification as sent
   * 
   * @param {string} userId - User ID
   * @param {string} notificationType - Type (1hour, 24hour, 46hour)
   * @param {Object} notificationData - Notification details
   * @param {Object} fcmResponse - FCM API response
   * @returns {Promise<number>} - Event ID
   */
  async markSent(userId, notificationType, notificationData, fcmResponse = null) {
    return this.recordEvent({
      userId,
      notificationType,
      eventType: 'sent',
      title: notificationData.title,
      body: notificationData.body,
      messageVariant: notificationData.messageVariant,
      sentVia: notificationData.sentVia || 'fcm',
      rewardType: notificationData.rewardType || 'coins',
      rewardAmount: notificationData.rewardAmount || 100,
      metadata: {
        fcmResponse,
        ...notificationData.metadata,
      },
    });
  }

  /**
   * Mark notification as clicked
   * 
   * @param {string} userId - User ID
   * @param {string} notificationType - Type (1hour, 24hour, 46hour)
   * @returns {Promise<number>} - Event ID
   */
  async markClicked(userId, notificationType) {
    return this.recordEvent({
      userId,
      notificationType,
      eventType: 'clicked',
      title: '',
      body: '',
      messageVariant: null,
      sentVia: null,
      rewardType: 'none',
      rewardAmount: 0,
      metadata: {},
    });
  }

  /**
   * Mark notification as failed
   * 
   * @param {string} userId - User ID
   * @param {string} notificationType - Type (1hour, 24hour, 46hour)
   * @param {string} errorMessage - Error message
   * @param {Object} notificationData - Notification details
   * @returns {Promise<number>} - Event ID
   */
  async markFailed(userId, notificationType, errorMessage, notificationData = {}) {
    return this.recordEvent({
      userId,
      notificationType,
      eventType: 'failed',
      title: notificationData.title || '',
      body: notificationData.body || '',
      messageVariant: notificationData.messageVariant || null,
      sentVia: notificationData.sentVia || 'fcm',
      rewardType: 'none',
      rewardAmount: 0,
      metadata: {
        errorMessage,
        ...notificationData.metadata,
      },
    });
  }

  /**
   * Mark reward as claimed
   * 
   * @param {number} eventId - Event ID
   * @returns {Promise<boolean>}
   */
  async markRewardClaimed(eventId) {
    try {
      await this.db.query(
        `UPDATE notification_events 
         SET reward_claimed = true 
         WHERE id = $1`,
        [eventId]
      );
      return true;
    } catch (error) {
      logger.error('❌ Failed to mark reward claimed', {
        eventId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get notification statistics for today
   * 
   * @returns {Promise<Object>}
   */
  async getTodayStats() {
    try {
      const result = await this.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'sent') as total_sent,
          COUNT(*) FILTER (WHERE event_type = 'clicked') as total_clicked,
          COUNT(*) FILTER (WHERE event_type = 'failed') as total_failed,
          COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'sent') as unique_users_sent,
          COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'clicked') as unique_users_clicked,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE event_type = 'clicked') / 
            NULLIF(COUNT(*) FILTER (WHERE event_type = 'sent'), 0),
            2
          ) as ctr_rate,
          COUNT(*) FILTER (WHERE event_type = 'sent' AND notification_type = '1hour') as sent_1hour,
          COUNT(*) FILTER (WHERE event_type = 'sent' AND notification_type = '24hour') as sent_24hour,
          COUNT(*) FILTER (WHERE event_type = 'sent' AND notification_type = '46hour') as sent_46hour
        FROM notification_events
        WHERE received_at >= CURRENT_DATE
      `);

      return result.rows[0];
    } catch (error) {
      logger.error('❌ Failed to get today notification stats', {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get notification statistics by country (last 7 days)
   * 
   * @returns {Promise<Array>}
   */
  async getStatsByCountry() {
    try {
      const result = await this.db.query(`
        SELECT
          country,
          COUNT(*) FILTER (WHERE event_type = 'sent') as sent,
          COUNT(*) FILTER (WHERE event_type = 'clicked') as clicked,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE event_type = 'clicked') / 
            NULLIF(COUNT(*) FILTER (WHERE event_type = 'sent'), 0),
            2
          ) as ctr_rate
        FROM notification_events
        WHERE received_at >= CURRENT_DATE - INTERVAL '7 days'
          AND country IS NOT NULL
        GROUP BY country
        ORDER BY sent DESC
        LIMIT 20
      `);

      return result.rows;
    } catch (error) {
      logger.error('❌ Failed to get notification stats by country', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get notification trend (last 30 days)
   * 
   * @returns {Promise<Array>}
   */
  async getNotificationTrend() {
    try {
      const result = await this.db.query(`
        SELECT
          DATE(received_at) as date,
          COUNT(*) FILTER (WHERE event_type = 'sent') as sent,
          COUNT(*) FILTER (WHERE event_type = 'clicked') as clicked,
          COUNT(*) FILTER (WHERE event_type = 'failed') as failed,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE event_type = 'clicked') / 
            NULLIF(COUNT(*) FILTER (WHERE event_type = 'sent'), 0),
            2
          ) as ctr_rate
        FROM notification_events
        WHERE received_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(received_at)
        ORDER BY date DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error('❌ Failed to get notification trend', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get user's notification history
   * 
   * @param {string} userId - User ID
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async getUserHistory(userId, limit = 20) {
    try {
      const result = await this.db.query(
        `SELECT
          id, notification_type, event_type,
          title, body, sent_via, reward_type, reward_amount, reward_claimed,
          sent_at, clicked_at, received_at
        FROM notification_events
        WHERE user_id = $1
        ORDER BY received_at DESC
        LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('❌ Failed to get user notification history', {
        userId,
        error: error.message,
      });
      return [];
    }
  }
}

module.exports = NotificationTracker;

