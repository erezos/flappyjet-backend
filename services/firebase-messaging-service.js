/**
 * Firebase Cloud Messaging V1 Service
 * Handles push notification sending via FCM V1 API
 * 
 * Features:
 * - Send notifications to individual devices
 * - Send batch notifications
 * - Handle token errors (invalid, unregistered)
 * - Track notification success/failure
 * - Support for Android notification channels
 */

const admin = require('firebase-admin');
const logger = require('../utils/logger');

class FirebaseMessagingService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize Firebase Admin SDK
   * Uses FIREBASE_SERVICE_ACCOUNT environment variable
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Check if service account is configured
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
      
      if (!serviceAccount) {
        logger.warn('⚠️  FIREBASE_SERVICE_ACCOUNT not configured. Push notifications will be disabled.');
        return;
      }

      // Parse service account JSON
      const serviceAccountObj = JSON.parse(serviceAccount);

      // Initialize Firebase Admin
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountObj),
        projectId: serviceAccountObj.project_id,
      });

      this.initialized = true;
      logger.info('🔥 Firebase Admin SDK initialized successfully', {
        projectId: serviceAccountObj.project_id,
      });
    } catch (error) {
      logger.error('❌ Failed to initialize Firebase Admin SDK', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Send push notification to a single device
   * 
   * @param {string} fcmToken - Device FCM token
   * @param {Object} notification - Notification data
   * @param {string} notification.title - Notification title
   * @param {string} notification.body - Notification body
   * @param {Object} notification.data - Custom data payload
   * @param {string} notification.channelId - Android notification channel
   * @returns {Promise<Object>} - FCM response
   */
  async sendNotification(fcmToken, notification) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      throw new Error('Firebase Admin SDK not initialized');
    }

    try {
      const message = {
        token: fcmToken,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data || {},
        android: {
          priority: 'high',
          notification: {
            channelId: notification.channelId || 'retention_notifications',
            sound: 'default',
            color: '#4FC3F7', // Flappy Jet brand color
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
      };

      // Send message
      const response = await admin.messaging().send(message);

      logger.info('✅ Push notification sent successfully', {
        token: fcmToken.substring(0, 20) + '...',
        messageId: response,
        title: notification.title,
      });

      return {
        success: true,
        messageId: response,
      };
    } catch (error) {
      logger.error('❌ Failed to send push notification', {
        token: fcmToken ? fcmToken.substring(0, 20) + '...' : 'null',
        error: error.message || 'Unknown error',
        errorCode: error.code || 'unknown',
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message || 'Unknown error',
        errorCode: error.code || 'unknown',
        isInvalidToken: this.isInvalidTokenError(error),
      };
    }
  }

  /**
   * Send notifications to multiple devices in batch
   * 
   * @param {Array<Object>} notifications - Array of notification objects
   * @param {string} notifications[].token - FCM token
   * @param {string} notifications[].title - Notification title
   * @param {string} notifications[].body - Notification body
   * @param {Object} notifications[].data - Custom data
   * @returns {Promise<Object>} - Batch send results
   */
  async sendBatchNotifications(notifications) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      throw new Error('Firebase Admin SDK not initialized');
    }

    // FCM supports up to 500 messages per batch
    const BATCH_SIZE = 500;
    const batches = [];
    
    for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
      batches.push(notifications.slice(i, i + BATCH_SIZE));
    }

    const results = {
      total: notifications.length,
      successful: 0,
      failed: 0,
      invalidTokens: [],
    };

    for (const batch of batches) {
      try {
        const messages = batch.map(notif => ({
          token: notif.token,
          notification: {
            title: notif.title,
            body: notif.body,
          },
          data: notif.data || {},
          android: {
            priority: 'high',
            notification: {
              channelId: notif.channelId || 'retention_notifications',
              sound: 'default',
              color: '#4FC3F7',
            },
          },
        }));

        const response = await admin.messaging().sendAll(messages);

        results.successful += response.successCount;
        results.failed += response.failureCount;

        // Track invalid tokens
        response.responses.forEach((resp, idx) => {
          if (!resp.success && this.isInvalidTokenError(resp.error)) {
            results.invalidTokens.push(batch[idx].token);
          }
        });

        logger.info('📊 Batch notifications sent', {
          batchSize: batch.length,
          successful: response.successCount,
          failed: response.failureCount,
        });
      } catch (error) {
        logger.error('❌ Batch send failed', {
          batchSize: batch.length,
          error: error.message,
        });
        results.failed += batch.length;
      }
    }

    return results;
  }

  /**
   * Check if error indicates invalid/unregistered token
   * 
   * @param {Error} error - FCM error
   * @returns {boolean}
   */
  isInvalidTokenError(error) {
    if (!error) return false;
    
    const invalidCodes = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
    ];

    return invalidCodes.includes(error.code);
  }

  /**
   * Validate FCM token format
   * 
   * @param {string} token - FCM token
   * @returns {boolean}
   */
  isValidTokenFormat(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // FCM tokens are typically 152+ characters
    // Start with specific prefixes
    return token.length >= 140;
  }
}

// Export singleton instance
const firebaseMessagingService = new FirebaseMessagingService();

module.exports = firebaseMessagingService;

