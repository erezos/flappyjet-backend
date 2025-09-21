/// 🕐 Smart Notification Scheduler with Timezone Awareness
/// Handles intelligent scheduling and delivery of push notifications

const cron = require('node-cron');
const moment = require('moment-timezone');
const FCMService = require('./fcm-service');
const logger = require('../utils/logger');

class SmartNotificationScheduler {
  constructor(db) {
    this.db = db;
    this.fcmService = new FCMService();
    this.isRunning = false;
    
    // Notification templates
    this.templates = {
      hearts_refilled: {
        title: '💖 Hearts Refilled!',
        body: 'Ready to fly again! Your hearts are fully charged! ✈️',
        type: 'hearts_refilled'
      },
      daily_streak: {
        title: '🎁 Daily Bonus Ready!',
        body: 'Your streak bonus is waiting! Claim it before it\'s gone! 🔥',
        type: 'daily_streak'
      },
      engagement_casual: {
        title: '🚀 Ready for Flight?',
        body: 'The skies are calling! Your jet is ready for adventure! ✈️',
        type: 'engagement'
      },
      engagement_competitive: {
        title: '🏆 Beat Your Best!',
        body: 'Think you can top your high score? Prove it! 🎯',
        type: 'engagement'
      },
      tournament_starting: {
        title: '🏆 Tournament Alert!',
        body: 'Weekly Championship starts in 1 hour! Join the competition! 🎮',
        type: 'tournament'
      },
      achievement_unlock: {
        title: '🏅 Achievement Unlocked!',
        body: 'Congratulations! You\'ve earned a new achievement! 🎉',
        type: 'achievement'
      }
    };
  }

  /**
   * Start all scheduled notification jobs
   */
  start() {
    if (this.isRunning) {
      logger.warn('🕐 Notification scheduler already running');
      return;
    }

    logger.info('🕐 Starting Smart Notification Scheduler...');

    // Hearts refill notifications - every 30 minutes
    this.heartsJob = cron.schedule('*/30 * * * *', () => {
      this.processHeartsRefilledNotifications();
    }, { scheduled: false });

    // Daily streak reminders - every hour during wake hours
    this.streakJob = cron.schedule('0 8-22 * * *', () => {
      this.processDailyStreakReminders();
    }, { scheduled: false });

    // Engagement reminders - every 4 hours during active hours
    this.engagementJob = cron.schedule('0 10,14,18,22 * * *', () => {
      this.processEngagementReminders();
    }, { scheduled: false });

    // Tournament notifications - check every 15 minutes
    this.tournamentJob = cron.schedule('*/15 * * * *', () => {
      this.processTournamentNotifications();
    }, { scheduled: false });

    // Cleanup job - daily at 3 AM UTC
    this.cleanupJob = cron.schedule('0 3 * * *', () => {
      this.performDailyCleanup();
    }, { scheduled: false });

    // Start all jobs
    this.heartsJob.start();
    this.streakJob.start();
    this.engagementJob.start();
    this.tournamentJob.start();
    this.cleanupJob.start();

    this.isRunning = true;
    logger.info('🕐 All notification jobs started successfully');
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    if (!this.isRunning) return;

    logger.info('🕐 Stopping notification scheduler...');
    
    this.heartsJob?.stop();
    this.streakJob?.stop();
    this.engagementJob?.stop();
    this.tournamentJob?.stop();
    this.cleanupJob?.stop();

    this.isRunning = false;
    logger.info('🕐 Notification scheduler stopped');
  }

  /**
   * Process hearts refilled notifications for Android users
   */
  async processHeartsRefilledNotifications() {
    try {
      logger.info('🕐 Processing hearts refilled notifications...');

      // Temporarily disabled - column doesn't exist in production yet
      logger.info('🕐 Hearts notifications temporarily disabled - schema migration needed');
      return;

      // Get Android users who need heart refill notifications
      const query = `
        SELECT 
          ft.token, 
          ft.player_id,
          p.nickname,
          p.timezone,
          p.current_hearts,
          p.hearts_last_regen
        FROM fcm_tokens ft 
        JOIN players p ON ft.player_id = p.id 
        WHERE ft.platform = 'android' 
        AND p.current_hearts < 3 
        AND p.hearts_last_regen < NOW() - INTERVAL '30 minutes'
        AND ft.token IS NOT NULL
      `;

      const result = await this.db.query(query);
      const users = result.rows;

      if (users.length === 0) {
        logger.info('🕐 No users need hearts refilled notifications');
        return;
      }

      const notifications = users.map(user => ({
        token: user.token,
        title: this.templates.hearts_refilled.title,
        body: this.templates.hearts_refilled.body,
        data: {
          type: 'hearts_refilled',
          player_id: user.player_id,
          hearts: user.hearts.toString(),
        },
        timezone: user.timezone || 'UTC',
      }));

      const results = await this.fcmService.sendBulkSmartNotifications(notifications);
      
      // Update last notification time for successfully sent notifications
      if (results.sent > 0) {
        const playerIds = users.slice(0, results.sent).map(u => u.player_id);
        await this.updateLastNotificationTime(playerIds, 'hearts_refilled');
      }

      logger.info(`🕐 Hearts notifications: ${results.sent} sent, ${results.scheduled} scheduled, ${results.failed} failed`);

    } catch (error) {
      logger.error('🕐 Error processing hearts refilled notifications:', error);
    }
  }

  /**
   * Process daily streak reminder notifications - ENHANCED with cycle awareness
   */
  async processDailyStreakReminders() {
    try {
      logger.info('🕐 Processing daily streak reminders...');

      const query = `
        SELECT 
          ft.token,
          ft.player_id,
          p.player_name,
          p.timezone,
          ds.current_streak,
          ds.current_cycle,
          ds.cycle_reward_set,
          ds.last_claim_date,
          p.notification_preferences
        FROM fcm_tokens ft 
        JOIN players p ON ft.player_id = p.id 
        JOIN daily_streaks ds ON p.id = ds.player_id
        WHERE ft.platform = 'android'
        AND (p.notification_preferences->>'streak')::boolean = true
        AND ds.last_claim_date < CURRENT_DATE
        AND ds.current_streak > 0
        AND NOT EXISTS (
          SELECT 1 FROM notification_history nh 
          WHERE nh.player_id = p.id 
          AND nh.type = 'daily_streak' 
          AND nh.sent_at > CURRENT_DATE
        )
      `;

      const result = await this.db.query(query);
      const users = result.rows;

      if (users.length === 0) {
        logger.info('🕐 No users need daily streak reminders');
        return;
      }

      const notifications = users.map(user => {
        const dayInCycle = user.current_streak % 7;
        const cycleNumber = user.current_cycle;
        const rewardSet = user.cycle_reward_set;
        
        let title, body;
        
        if (dayInCycle === 0 && user.current_streak > 0) {
          // Day 7 - cycle completion
          title = '🎉 Cycle Complete!';
          body = `You've completed cycle ${cycleNumber}! Start your new cycle today!`;
        } else if (dayInCycle === 6) {
          // Day 7 - about to complete cycle
          title = '🔥 Final Day!';
          body = `Day 7 streak bonus! Complete your cycle and get amazing rewards!`;
        } else {
          // Regular day
          const dayNumber = dayInCycle + 1;
          title = '🔥 Daily Streak Bonus';
          
          if (rewardSet === 'new_player' && dayNumber === 2) {
            body = `Day ${dayNumber} streak bonus! Get your Flash Strike jet today! ✈️`;
          } else {
            body = `Day ${dayNumber} streak bonus awaiting! Don't break the chain! 🔥`;
          }
        }
        
        return {
          token: user.token,
          title: title,
          body: body,
          data: {
            type: 'daily_streak',
            player_id: user.player_id,
            streak: user.current_streak.toString(),
            cycle: cycleNumber.toString(),
            day_in_cycle: dayInCycle.toString(),
            reward_set: rewardSet,
          },
          timezone: user.timezone || 'UTC',
        };
      });

      const results = await this.fcmService.sendBulkSmartNotifications(notifications);
      
      // Log notification history
      if (results.sent > 0) {
        await this.logNotificationHistory(users.slice(0, results.sent), 'daily_streak');
      }

      logger.info(`🕐 Enhanced streak notifications: ${results.sent} sent, ${results.scheduled} scheduled, ${results.failed} failed`);

    } catch (error) {
      logger.error('🕐 Error processing daily streak reminders:', error);
    }
  }

  /**
   * Process engagement reminder notifications
   */
  async processEngagementReminders() {
    try {
      logger.info('🕐 Processing engagement reminders...');

      const query = `
        SELECT 
          ft.token,
          ft.player_id,
          p.player_name,
          p.timezone,
          p.last_game_played,
          p.total_games_played,
          p.best_score,
          p.notification_preferences
        FROM fcm_tokens ft 
        JOIN players p ON ft.player_id = p.id 
        WHERE ft.platform = 'android'
        AND (p.notification_preferences->>'engagement')::boolean = true
        AND p.last_game_played < NOW() - INTERVAL '4 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notification_history nh 
          WHERE nh.player_id = p.id 
          AND nh.type = 'engagement' 
          AND nh.sent_at > NOW() - INTERVAL '4 hours'
        )
        ORDER BY p.last_game_played ASC
        LIMIT 1000
      `;

      const result = await this.db.query(query);
      const users = result.rows;

      if (users.length === 0) {
        logger.info('🕐 No users need engagement reminders');
        return;
      }

      const notifications = users.map(user => {
        // Choose template based on user behavior
        const isCompetitive = user.total_games_played > 50 && user.best_score > 20;
        const template = isCompetitive ? 
          this.templates.engagement_competitive : 
          this.templates.engagement_casual;

        return {
          token: user.token,
          title: template.title,
          body: isCompetitive ? 
            `Your best is ${user.best_score}. Think you can beat it? 🎯` : 
            template.body,
          data: {
            type: 'engagement',
            player_id: user.player_id,
            best_score: user.best_score.toString(),
          },
          timezone: user.timezone || 'UTC',
        };
      });

      const results = await this.fcmService.sendBulkSmartNotifications(notifications);
      
      if (results.sent > 0) {
        await this.logNotificationHistory(users.slice(0, results.sent), 'engagement');
      }

      logger.info(`🕐 Engagement notifications: ${results.sent} sent, ${results.scheduled} scheduled, ${results.failed} failed`);

    } catch (error) {
      logger.error('🕐 Error processing engagement reminders:', error);
    }
  }

  /**
   * Process tournament-related notifications
   */
  async processTournamentNotifications() {
    try {
      // Get upcoming tournaments
      const tournamentQuery = `
        SELECT id, name, start_date, end_date 
        FROM tournaments 
        WHERE start_date > NOW() 
        AND start_date < NOW() + INTERVAL '1 hour'
        AND status = 'scheduled'
      `;

      const tournaments = await this.db.query(tournamentQuery);

      for (const tournament of tournaments.rows) {
        // Get Android users who haven't been notified about this tournament
        const usersQuery = `
          SELECT ft.token, ft.player_id, p.timezone, p.nickname
          FROM fcm_tokens ft 
          JOIN players p ON ft.player_id = p.id 
          WHERE ft.platform = 'android'
          AND NOT EXISTS (
            SELECT 1 FROM notification_history nh 
            WHERE nh.player_id = p.id 
            AND nh.type = 'tournament' 
            AND nh.metadata->>'tournament_id' = $1
          )
        `;

        const users = await this.db.query(usersQuery, [tournament.id]);

        if (users.rows.length > 0) {
          const notifications = users.rows.map(user => ({
            token: user.token,
            title: this.templates.tournament_starting.title,
            body: `${tournament.name} starts soon! Join now! 🏆`,
            data: {
              type: 'tournament',
              player_id: user.player_id,
              tournament_id: tournament.id,
              tournament_name: tournament.name,
            },
            timezone: user.timezone || 'UTC',
          }));

          const results = await this.fcmService.sendBulkSmartNotifications(notifications);
          
          if (results.sent > 0) {
            await this.logNotificationHistory(
              users.rows.slice(0, results.sent), 
              'tournament',
              { tournament_id: tournament.id }
            );
          }

          logger.info(`🕐 Tournament ${tournament.name}: ${results.sent} notifications sent`);
        }
      }

    } catch (error) {
      logger.error('🕐 Error processing tournament notifications:', error);
    }
  }

  /**
   * Update last notification time for players
   */
  async updateLastNotificationTime(playerIds, type) {
    try {
      const placeholders = playerIds.map((_, index) => `$${index + 1}`).join(',');
      await this.db.query(
        `UPDATE players SET last_${type}_notification = NOW() WHERE id IN (${placeholders})`,
        playerIds
      );
    } catch (error) {
      logger.error(`🕐 Failed to update last notification time for ${type}:`, error);
    }
  }

  /**
   * Log notification history for analytics
   */
  async logNotificationHistory(users, type, metadata = {}) {
    try {
      const values = users.map(user => 
        `('${user.player_id}', '${type}', NOW(), '${JSON.stringify(metadata)}')`
      ).join(',');

      await this.db.query(`
        INSERT INTO notification_history (player_id, type, sent_at, metadata) 
        VALUES ${values}
      `);
    } catch (error) {
      logger.error('🕐 Failed to log notification history:', error);
    }
  }

  /**
   * Perform daily cleanup tasks
   */
  async performDailyCleanup() {
    try {
      logger.info('🕐 Performing daily cleanup...');

      // Clean up old notification history (keep last 30 days)
      await this.db.query(`
        DELETE FROM notification_history 
        WHERE sent_at < NOW() - INTERVAL '30 days'
      `);

      // Clean up invalid FCM tokens (tokens that consistently fail)
      await this.db.query(`
        DELETE FROM fcm_tokens 
        WHERE updated_at < NOW() - INTERVAL '90 days'
      `);

      logger.info('🕐 Daily cleanup completed');

    } catch (error) {
      logger.error('🕐 Error during daily cleanup:', error);
    }
  }

  /**
   * Get scheduler statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      jobs: {
        hearts: this.heartsJob?.running || false,
        streak: this.streakJob?.running || false,
        engagement: this.engagementJob?.running || false,
        tournament: this.tournamentJob?.running || false,
        cleanup: this.cleanupJob?.running || false,
      },
      fcmStats: this.fcmService.getStats(),
    };
  }
}

module.exports = SmartNotificationScheduler;
