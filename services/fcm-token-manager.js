/**
 * FCM Token Manager
 * Handles FCM token registration, updates, and lifecycle
 * 
 * Features:
 * - Register/update FCM tokens
 * - Deactivate invalid tokens
 * - Get active tokens for users
 * - Track token metadata (country, device, timezone)
 */

const logger = require('../utils/logger');

class FCMTokenManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * Register or update FCM token for a user
   * 
   * @param {Object} tokenData - Token registration data
   * @param {string} tokenData.userId - User ID
   * @param {string} tokenData.fcmToken - FCM token
   * @param {string} tokenData.platform - Platform (android/ios)
   * @param {string} tokenData.country - Country code
   * @param {string} tokenData.timezone - User timezone
   * @param {string} tokenData.deviceModel - Device model
   * @param {string} tokenData.osVersion - OS version
   * @param {string} tokenData.appVersion - App version
   * @returns {Promise<Object>}
   */
  async registerToken(tokenData) {
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
      } = tokenData;

      // Deactivate any existing tokens for this user (only one active token per user)
      await this.db.query(
        `UPDATE fcm_tokens 
         SET is_active = false, 
             updated_at = NOW()
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );

      // Insert or update the new token
      const result = await this.db.query(
        `INSERT INTO fcm_tokens (
          user_id, fcm_token, platform, country, timezone,
          device_model, os_version, app_version,
          is_active, created_at, updated_at, last_used_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW(), NOW())
        ON CONFLICT (user_id, fcm_token)
        DO UPDATE SET
          is_active = true,
          platform = $3,
          country = $4,
          timezone = $5,
          device_model = $6,
          os_version = $7,
          app_version = $8,
          updated_at = NOW(),
          last_used_at = NOW()
        RETURNING id, user_id, fcm_token, is_active`,
        [userId, fcmToken, platform, country, timezone, deviceModel, osVersion, appVersion]
      );

      logger.info('✅ FCM token registered', {
        userId,
        platform,
        country,
        tokenId: result.rows[0].id,
      });

      return {
        success: true,
        tokenId: result.rows[0].id,
      };
    } catch (error) {
      logger.error('❌ Failed to register FCM token', {
        userId: tokenData.userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get active FCM token for a user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} - FCM token or null
   */
  async getActiveToken(userId) {
    try {
      const result = await this.db.query(
        'SELECT get_active_fcm_token($1) as token',
        [userId]
      );

      return result.rows[0]?.token || null;
    } catch (error) {
      logger.error('❌ Failed to get active FCM token', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Deactivate a specific FCM token (e.g., after send failure)
   * 
   * @param {string} fcmToken - FCM token to deactivate
   * @returns {Promise<boolean>}
   */
  async deactivateToken(fcmToken) {
    try {
      await this.db.query(
        `UPDATE fcm_tokens 
         SET is_active = false, 
             updated_at = NOW()
         WHERE fcm_token = $1`,
        [fcmToken]
      );

      logger.info('🔕 FCM token deactivated', {
        token: fcmToken.substring(0, 20) + '...',
      });

      return true;
    } catch (error) {
      logger.error('❌ Failed to deactivate FCM token', {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Deactivate all tokens for a user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<boolean>}
   */
  async deactivateAllTokensForUser(userId) {
    try {
      await this.db.query(
        `UPDATE fcm_tokens 
         SET is_active = false, 
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );

      logger.info('🔕 All FCM tokens deactivated for user', { userId });
      return true;
    } catch (error) {
      logger.error('❌ Failed to deactivate user tokens', {
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Update last notification sent timestamp
   * 
   * @param {string} fcmToken - FCM token
   * @returns {Promise<void>}
   */
  async updateLastNotificationSent(fcmToken) {
    try {
      await this.db.query(
        `UPDATE fcm_tokens 
         SET last_notification_sent_at = NOW(),
             updated_at = NOW()
         WHERE fcm_token = $1`,
        [fcmToken]
      );
    } catch (error) {
      logger.error('❌ Failed to update last notification sent', {
        error: error.message,
      });
    }
  }

  /**
   * Update last notification clicked timestamp
   * 
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async updateLastNotificationClicked(userId) {
    try {
      await this.db.query(
        `UPDATE fcm_tokens 
         SET last_notification_clicked_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
    } catch (error) {
      logger.error('❌ Failed to update last notification clicked', {
        userId,
        error: error.message,
      });
    }
  }

  /**
   * Get all active tokens (for batch sends)
   * 
   * @param {Object} filters - Optional filters
   * @param {string} filters.country - Filter by country
   * @param {string} filters.platform - Filter by platform
   * @param {number} filters.limit - Limit results
   * @returns {Promise<Array>}
   */
  async getActiveTokens(filters = {}) {
    try {
      let query = `
        SELECT user_id, fcm_token, platform, country, timezone, device_model
        FROM fcm_tokens
        WHERE is_active = true
      `;
      const params = [];
      let paramIndex = 1;

      if (filters.country) {
        query += ` AND country = $${paramIndex}`;
        params.push(filters.country);
        paramIndex++;
      }

      if (filters.platform) {
        query += ` AND platform = $${paramIndex}`;
        params.push(filters.platform);
        paramIndex++;
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(filters.limit);
      }

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('❌ Failed to get active tokens', {
        filters,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get token statistics
   * 
   * @returns {Promise<Object>}
   */
  async getTokenStats() {
    try {
      const result = await this.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE is_active = true) as active_tokens,
          COUNT(DISTINCT user_id) FILTER (WHERE is_active = true) as active_users,
          COUNT(*) FILTER (WHERE platform = 'android') as android_tokens,
          COUNT(*) FILTER (WHERE platform = 'ios') as ios_tokens,
          COUNT(*) FILTER (WHERE last_notification_sent_at >= NOW() - INTERVAL '24 hours') as sent_last_24h
        FROM fcm_tokens
      `);

      return result.rows[0];
    } catch (error) {
      logger.error('❌ Failed to get token stats', {
        error: error.message,
      });
      return null;
    }
  }
}

module.exports = FCMTokenManager;

