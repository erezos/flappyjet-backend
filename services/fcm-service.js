/// 🔥 Firebase Cloud Messaging Service with Smart Timezone Awareness
/// Handles push notifications for Android users with intelligent scheduling

const admin = require('firebase-admin');
const moment = require('moment-timezone');
const logger = require('../utils/logger');

class FCMService {
  constructor() {
    this.isInitialized = false;
    this.initializeFirebase();
  }

  /**
   * Initialize Firebase Admin SDK
   */
  initializeFirebase() {
    try {
      if (!admin.apps.length) {
        const serviceAccount = {
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        };

        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });

        this.isInitialized = true;
        logger.info('🔥 Firebase Admin SDK initialized successfully');
      }
    } catch (error) {
      logger.error('🔥 Failed to initialize Firebase Admin SDK:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Check if user is in sleeping hours based on their timezone
   * @param {string} timezone - User's timezone (e.g., 'America/New_York')
   * @param {number} sleepStart - Sleep start hour (24h format, default: 22)
   * @param {number} sleepEnd - Sleep end hour (24h format, default: 8)
   * @returns {boolean} - True if user is likely sleeping
   */
  isUserSleeping(timezone, sleepStart = 22, sleepEnd = 8) {
    try {
      const userTime = moment().tz(timezone);
      const currentHour = userTime.hour();

      // Handle sleep hours that cross midnight (e.g., 22:00 to 08:00)
      if (sleepStart > sleepEnd) {
        return currentHour >= sleepStart || currentHour < sleepEnd;
      } else {
        // Handle sleep hours within same day (e.g., 02:00 to 06:00)
        return currentHour >= sleepStart && currentHour < sleepEnd;
      }
    } catch (error) {
      logger.warn(`🔥 Invalid timezone ${timezone}, assuming user is awake`);
      return false; // Default to awake if timezone is invalid
    }
  }

  /**
   * Get next suitable time to send notification (avoiding sleep hours)
   * @param {string} timezone - User's timezone
   * @param {number} sleepStart - Sleep start hour
   * @param {number} sleepEnd - Sleep end hour
   * @returns {moment.Moment} - Next suitable time
   */
  getNextSuitableTime(timezone, sleepStart = 22, sleepEnd = 8) {
    try {
      const userTime = moment().tz(timezone);
      
      if (!this.isUserSleeping(timezone, sleepStart, sleepEnd)) {
        // User is awake, send now
        return userTime;
      }

      // User is sleeping, schedule for wake-up time
      const wakeUpTime = userTime.clone().hour(sleepEnd).minute(0).second(0);
      
      // If wake-up time is in the past today, schedule for tomorrow
      if (wakeUpTime.isBefore(userTime)) {
        wakeUpTime.add(1, 'day');
      }

      return wakeUpTime;
    } catch (error) {
      logger.warn(`🔥 Error calculating suitable time for ${timezone}:`, error);
      return moment(); // Default to now
    }
  }

  /**
   * Send notification to single user with timezone awareness
   * @param {string} token - FCM token
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data payload
   * @param {string} timezone - User's timezone
   * @param {Object} options - Additional options
   */
  async sendSmartNotification(token, title, body, data = {}, timezone = 'UTC', options = {}) {
    if (!this.isInitialized) {
      logger.error('🔥 FCM Service not initialized');
      return { success: false, error: 'FCM not initialized' };
    }

    try {
      // Check if user is sleeping
      if (this.isUserSleeping(timezone) && !options.ignoreTimezone) {
        const nextSuitableTime = this.getNextSuitableTime(timezone);
        logger.info(`🔥 User in ${timezone} is sleeping, scheduling for ${nextSuitableTime.format()}`);
        
        // Store notification for later delivery (you'd implement a queue system)
        return { 
          success: true, 
          scheduled: true, 
          deliveryTime: nextSuitableTime.toISOString(),
          message: 'Notification scheduled for suitable time'
        };
      }

      // User is awake, send immediately
      const message = {
        token,
        notification: {
          title,
          body,
        },
        data: {
          ...data,
          timestamp: Date.now().toString(),
          timezone,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: this.getChannelId(data.type),
            priority: 'high',
            sound: 'default',
            vibrationPattern: [0, 250, 250, 250],
            lightSettings: {
              color: '#2196F3',
              lightOnDurationMillis: 200,
              lightOffDurationMillis: 200,
            },
          },
        },
      };

      const result = await admin.messaging().send(message);
      
      logger.info(`🔥 Notification sent successfully to ${timezone}:`, {
        token: token.substring(0, 20) + '...',
        title,
        messageId: result,
      });

      return { success: true, messageId: result };

    } catch (error) {
      logger.error('🔥 Failed to send notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notifications to multiple users with timezone awareness
   * @param {Array} notifications - Array of {token, title, body, data, timezone}
   */
  async sendBulkSmartNotifications(notifications) {
    if (!this.isInitialized) {
      logger.error('🔥 FCM Service not initialized');
      return { success: false, error: 'FCM not initialized' };
    }

    const results = {
      sent: 0,
      scheduled: 0,
      failed: 0,
      details: []
    };

    // Group notifications by immediate vs scheduled
    const immediateNotifications = [];
    const scheduledNotifications = [];

    for (const notification of notifications) {
      const { token, title, body, data, timezone } = notification;
      
      if (this.isUserSleeping(timezone)) {
        const nextSuitableTime = this.getNextSuitableTime(timezone);
        scheduledNotifications.push({
          ...notification,
          deliveryTime: nextSuitableTime.toISOString(),
        });
        results.scheduled++;
      } else {
        immediateNotifications.push(notification);
      }
    }

    // Send immediate notifications in batches
    if (immediateNotifications.length > 0) {
      try {
        const batchSize = 500; // FCM limit
        for (let i = 0; i < immediateNotifications.length; i += batchSize) {
          const batch = immediateNotifications.slice(i, i + batchSize);
          
          const messages = batch.map(notif => ({
            token: notif.token,
            notification: {
              title: notif.title,
              body: notif.body,
            },
            data: {
              ...notif.data,
              timestamp: Date.now().toString(),
              timezone: notif.timezone,
            },
            android: {
              priority: 'high',
              notification: {
                channelId: this.getChannelId(notif.data?.type),
                priority: 'high',
                sound: 'default',
              },
            },
          }));

          const batchResult = await admin.messaging().sendAll(messages);
          
          results.sent += batchResult.successCount;
          results.failed += batchResult.failureCount;
          
          // Log failed tokens for cleanup
          batchResult.responses.forEach((response, index) => {
            if (!response.success) {
              logger.warn(`🔥 Failed to send to token ${batch[index].token.substring(0, 20)}...`, response.error);
            }
          });
        }
      } catch (error) {
        logger.error('🔥 Batch notification sending failed:', error);
        results.failed += immediateNotifications.length;
      }
    }

    // Store scheduled notifications (implement queue system)
    if (scheduledNotifications.length > 0) {
      // TODO: Implement notification queue/scheduler
      logger.info(`🔥 ${scheduledNotifications.length} notifications scheduled for later delivery`);
    }

    logger.info('🔥 Bulk notification results:', results);
    return results;
  }

  /**
   * Get appropriate notification channel ID based on type
   * @param {string} type - Notification type
   * @returns {string} - Channel ID
   */
  getChannelId(type) {
    const channelMap = {
      hearts_refilled: 'hearts_refilled_channel',
      daily_streak: 'daily_streak_channel',
      engagement: 'engagement_reminder_channel',
      tournament: 'tournament_channel',
      achievement: 'achievement_channel',
    };

    return channelMap[type] || 'default_channel';
  }

  /**
   * Validate FCM token format
   * @param {string} token - FCM token to validate
   * @returns {boolean} - True if valid
   */
  isValidToken(token) {
    // FCM tokens are typically 152+ characters long
    return typeof token === 'string' && token.length > 100;
  }

  /**
   * Clean up invalid tokens from database
   * @param {Array} invalidTokens - Array of invalid tokens to remove
   */
  async cleanupInvalidTokens(invalidTokens, db) {
    if (invalidTokens.length === 0) return;

    try {
      const placeholders = invalidTokens.map((_, index) => `$${index + 1}`).join(',');
      await db.query(
        `DELETE FROM fcm_tokens WHERE token IN (${placeholders})`,
        invalidTokens
      );
      
      logger.info(`🔥 Cleaned up ${invalidTokens.length} invalid FCM tokens`);
    } catch (error) {
      logger.error('🔥 Failed to cleanup invalid tokens:', error);
    }
  }

  /**
   * Get notification statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      firebaseApps: admin.apps.length,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = FCMService;
