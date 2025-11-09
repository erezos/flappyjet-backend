/**
 * Analytics Aggregator Service
 * Processes events and updates analytics tables
 * 
 * This service:
 * 1. Aggregates daily KPIs from events
 * 2. Calculates currency breakdowns
 * 3. Updates user stats in real-time
 * 4. Generates hourly metrics
 * 
 * Called by cron jobs:
 * - Hourly: Update analytics_daily for today
 * - Daily 00:01: Finalize yesterday's data
 */

const logger = require('../utils/logger');

class AnalyticsAggregator {
  constructor(db) {
    this.db = db;
    this.stats = {
      daily_aggregations: 0,
      hourly_aggregations: 0,
      user_updates: 0,
      last_aggregation: null,
    };
  }

  /**
   * Aggregate daily KPIs from events
   * Called every hour by cron
   * @param {Date} date - Date to aggregate (defaults to today)
   * @returns {Promise<Object>} - { success, date, metrics }
   */
  async aggregateDailyKPIs(date = new Date()) {
    const startTime = Date.now();
    const dateStr = date.toISOString().split('T')[0];
    
    try {
      logger.info('📊 Aggregating daily KPIs', { date: dateStr });

      // 1. DAU (Daily Active Users)
      const dau = await this.db.query(`
        SELECT COUNT(DISTINCT user_id) as dau
        FROM events
        WHERE DATE(received_at) = $1
      `, [dateStr]);

      // 2. New users (app_installed events)
      const newUsers = await this.db.query(`
        SELECT COUNT(DISTINCT user_id) as count
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = 'app_installed'
      `, [dateStr]);

      // 3. Games played
      const games = await this.db.query(`
        SELECT 
          COUNT(*) as games_completed,
          COUNT(DISTINCT user_id) as unique_players
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = 'game_ended'
      `, [dateStr]);

      // 4. Currency earned (coins + gems)
      const coinsEarned = await this.aggregateCurrency(dateStr, 'currency_earned', 'coins');
      const gemsEarned = await this.aggregateCurrency(dateStr, 'currency_earned', 'gems');

      // 5. Currency spent (coins + gems)
      const coinsSpent = await this.aggregateCurrency(dateStr, 'currency_spent', 'coins');
      const gemsSpent = await this.aggregateCurrency(dateStr, 'currency_spent', 'gems');

      // 6. Levels completed
      const levels = await this.db.query(`
        SELECT COUNT(*) as count
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = 'level_completed'
      `, [dateStr]);

      // 7. Continues used
      const continues = await this.db.query(`
        SELECT COUNT(*) as count
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = 'continue_used'
      `, [dateStr]);

      // 8. Achievements unlocked
      const achievements = await this.db.query(`
        SELECT COUNT(*) as count
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = 'achievement_unlocked'
      `, [dateStr]);

      // 9. Missions completed
      const missions = await this.db.query(`
        SELECT COUNT(*) as count
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = 'mission_completed'
      `, [dateStr]);

      // 10. Game mode breakdown
      const gameModes = await this.db.query(`
        SELECT 
          (payload->>'game_mode')::text as game_mode,
          COUNT(*) as count
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = 'game_ended'
        GROUP BY game_mode
      `, [dateStr]);

      const endlessGames = gameModes.rows.find(r => r.game_mode === 'endless')?.count || 0;
      const storyGames = gameModes.rows.find(r => r.game_mode === 'story')?.count || 0;

      // 11. Platform breakdown
      const platforms = await this.db.query(`
        SELECT 
          (payload->>'platform')::text as platform,
          COUNT(DISTINCT user_id) as users
        FROM events
        WHERE DATE(received_at) = $1
        GROUP BY platform
      `, [dateStr]);

      const iosUsers = platforms.rows.find(r => r.platform === 'ios')?.users || 0;
      const androidUsers = platforms.rows.find(r => r.platform === 'android')?.users || 0;

      // 12. Upsert into analytics_daily
      const result = await this.db.query(`
        INSERT INTO analytics_daily (
          date, dau, new_users, games_started, games_completed,
          total_coins_earned, total_coins_spent,
          total_gems_earned, total_gems_spent,
          levels_completed, continues_used,
          achievements_unlocked, missions_completed,
          endless_games_played, story_games_played,
          ios_users, android_users,
          coins_earned_by_source, coins_spent_on,
          gems_earned_by_source, gems_spent_on,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, NOW()
        )
        ON CONFLICT (date) DO UPDATE SET
          dau = EXCLUDED.dau,
          new_users = EXCLUDED.new_users,
          games_completed = EXCLUDED.games_completed,
          total_coins_earned = EXCLUDED.total_coins_earned,
          total_coins_spent = EXCLUDED.total_coins_spent,
          total_gems_earned = EXCLUDED.total_gems_earned,
          total_gems_spent = EXCLUDED.total_gems_spent,
          levels_completed = EXCLUDED.levels_completed,
          continues_used = EXCLUDED.continues_used,
          achievements_unlocked = EXCLUDED.achievements_unlocked,
          missions_completed = EXCLUDED.missions_completed,
          endless_games_played = EXCLUDED.endless_games_played,
          story_games_played = EXCLUDED.story_games_played,
          ios_users = EXCLUDED.ios_users,
          android_users = EXCLUDED.android_users,
          coins_earned_by_source = EXCLUDED.coins_earned_by_source,
          coins_spent_on = EXCLUDED.coins_spent_on,
          gems_earned_by_source = EXCLUDED.gems_earned_by_source,
          gems_spent_on = EXCLUDED.gems_spent_on,
          updated_at = NOW()
        RETURNING *
      `, [
        dateStr,
        parseInt(dau.rows[0].dau),
        parseInt(newUsers.rows[0].count),
        parseInt(games.rows[0].games_completed), // games_started = games_completed for now
        parseInt(games.rows[0].games_completed),
        coinsEarned.total,
        coinsSpent.total,
        gemsEarned.total,
        gemsSpent.total,
        parseInt(levels.rows[0].count),
        parseInt(continues.rows[0].count),
        parseInt(achievements.rows[0].count),
        parseInt(missions.rows[0].count),
        endlessGames,
        storyGames,
        iosUsers,
        androidUsers,
        JSON.stringify(coinsEarned.breakdown),
        JSON.stringify(coinsSpent.breakdown),
        JSON.stringify(gemsEarned.breakdown),
        JSON.stringify(gemsSpent.breakdown)
      ]);

      const duration = Date.now() - startTime;
      this.stats.daily_aggregations++;
      this.stats.last_aggregation = new Date();

      logger.info('✅ Daily KPIs aggregated', {
        date: dateStr,
        dau: result.rows[0].dau,
        games: result.rows[0].games_completed,
        duration_ms: duration
      });

      return {
        success: true,
        date: dateStr,
        metrics: result.rows[0],
        duration_ms: duration
      };

    } catch (error) {
      logger.error('💥 Error aggregating daily KPIs', { 
        error: error.message,
        date: dateStr 
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Aggregate currency data with breakdown
   * @param {string} date - Date string (YYYY-MM-DD)
   * @param {string} eventType - 'currency_earned' or 'currency_spent'
   * @param {string} currencyType - 'coins' or 'gems'
   * @returns {Promise<Object>} - { total, breakdown }
   */
  async aggregateCurrency(date, eventType, currencyType) {
    try {
      const result = await this.db.query(`
        SELECT 
          SUM((payload->>'amount')::int) as total,
          COALESCE(payload->>'source', payload->>'spent_on') as category
        FROM events
        WHERE DATE(received_at) = $1
          AND event_type = $2
          AND (payload->>'currency_type')::text = $3
        GROUP BY category
      `, [date, eventType, currencyType]);

      const total = result.rows.reduce((sum, row) => sum + (parseInt(row.total) || 0), 0);
      const breakdown = {};
      
      result.rows.forEach(row => {
        const key = row.category || 'unknown';
        breakdown[key] = parseInt(row.total) || 0;
      });

      return { total, breakdown };

    } catch (error) {
      logger.error('❌ Error aggregating currency', { 
        error: error.message,
        eventType,
        currencyType 
      });
      return { total: 0, breakdown: {} };
    }
  }

  /**
   * Update real-time user stats from events
   * This can be called periodically or triggered by specific events
   * @param {string} userId - User ID to update
   * @returns {Promise<Object>}
   */
  async updateUserStats(userId) {
    try {
      logger.debug('📊 Updating user stats', { userId });

      // Aggregate all stats for this user from events
      const stats = await this.db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE event_type = 'game_ended') as total_games_played,
          SUM((payload->>'score')::int) FILTER (WHERE event_type = 'game_ended') as total_score,
          MAX((payload->>'score')::int) FILTER (WHERE event_type = 'game_ended') as high_score,
          SUM((payload->>'duration_seconds')::int) FILTER (WHERE event_type = 'game_ended') as total_playtime_seconds,
          SUM((payload->>'amount')::int) FILTER (WHERE event_type = 'currency_earned' AND payload->>'currency_type' = 'coins') as total_coins_earned,
          SUM((payload->>'amount')::int) FILTER (WHERE event_type = 'currency_spent' AND payload->>'currency_type' = 'coins') as total_coins_spent,
          SUM((payload->>'amount')::int) FILTER (WHERE event_type = 'currency_earned' AND payload->>'currency_type' = 'gems') as total_gems_earned,
          SUM((payload->>'amount')::int) FILTER (WHERE event_type = 'currency_spent' AND payload->>'currency_type' = 'gems') as total_gems_spent,
          COUNT(*) FILTER (WHERE event_type = 'level_completed') as levels_completed,
          COUNT(*) FILTER (WHERE event_type = 'achievement_unlocked') as achievements_unlocked,
          COUNT(*) FILTER (WHERE event_type = 'mission_completed') as missions_completed,
          COUNT(*) FILTER (WHERE event_type = 'skin_unlocked') as skins_unlocked,
          COUNT(*) FILTER (WHERE event_type = 'app_launched') as total_sessions,
          COUNT(*) FILTER (WHERE event_type = 'continue_used') as continues_used,
          COUNT(*) FILTER (WHERE event_type = 'ad_watched') as ads_watched,
          COUNT(*) FILTER (WHERE event_type = 'purchase_completed') as purchases_made,
          MIN(received_at) as first_seen_at,
          MAX(received_at) as last_active_at
        FROM events
        WHERE user_id = $1
      `, [userId]);

      const data = stats.rows[0];

      // Upsert into user_stats_realtime
      await this.db.query(`
        INSERT INTO user_stats_realtime (
          user_id,
          total_games_played,
          total_score,
          high_score,
          total_playtime_seconds,
          total_coins_earned,
          total_coins_spent,
          total_gems_earned,
          total_gems_spent,
          levels_completed,
          achievements_unlocked,
          missions_completed,
          skins_unlocked,
          total_sessions,
          continues_used,
          ads_watched,
          purchases_made,
          first_seen_at,
          last_active_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          total_games_played = EXCLUDED.total_games_played,
          total_score = EXCLUDED.total_score,
          high_score = EXCLUDED.high_score,
          total_playtime_seconds = EXCLUDED.total_playtime_seconds,
          total_coins_earned = EXCLUDED.total_coins_earned,
          total_coins_spent = EXCLUDED.total_coins_spent,
          total_gems_earned = EXCLUDED.total_gems_earned,
          total_gems_spent = EXCLUDED.total_gems_spent,
          levels_completed = EXCLUDED.levels_completed,
          achievements_unlocked = EXCLUDED.achievements_unlocked,
          missions_completed = EXCLUDED.missions_completed,
          skins_unlocked = EXCLUDED.skins_unlocked,
          total_sessions = EXCLUDED.total_sessions,
          continues_used = EXCLUDED.continues_used,
          ads_watched = EXCLUDED.ads_watched,
          purchases_made = EXCLUDED.purchases_made,
          last_active_at = EXCLUDED.last_active_at,
          updated_at = NOW()
      `, [
        userId,
        parseInt(data.total_games_played) || 0,
        parseInt(data.total_score) || 0,
        parseInt(data.high_score) || 0,
        parseInt(data.total_playtime_seconds) || 0,
        parseInt(data.total_coins_earned) || 0,
        parseInt(data.total_coins_spent) || 0,
        parseInt(data.total_gems_earned) || 0,
        parseInt(data.total_gems_spent) || 0,
        parseInt(data.levels_completed) || 0,
        parseInt(data.achievements_unlocked) || 0,
        parseInt(data.missions_completed) || 0,
        parseInt(data.skins_unlocked) || 0,
        parseInt(data.total_sessions) || 0,
        parseInt(data.continues_used) || 0,
        parseInt(data.ads_watched) || 0,
        parseInt(data.purchases_made) || 0,
        data.first_seen_at,
        data.last_active_at
      ]);

      this.stats.user_updates++;

      return { success: true, userId };

    } catch (error) {
      logger.error('❌ Error updating user stats', { 
        error: error.message,
        userId 
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Aggregate hourly metrics
   * Used for real-time dashboard monitoring
   * @returns {Promise<Object>}
   */
  async aggregateHourlyMetrics() {
    try {
      const currentHour = new Date();
      currentHour.setMinutes(0, 0, 0);

      logger.info('📊 Aggregating hourly metrics', { hour: currentHour.toISOString() });

      const metrics = await this.db.query(`
        SELECT 
          COUNT(DISTINCT user_id) as active_users,
          COUNT(*) FILTER (WHERE event_type = 'game_ended') as games_played,
          SUM((payload->>'coins_collected')::int) FILTER (WHERE event_type = 'game_ended') as coins_earned,
          SUM((payload->>'gems_collected')::int) FILTER (WHERE event_type = 'game_ended') as gems_earned
        FROM events
        WHERE received_at >= $1
          AND received_at < $1 + INTERVAL '1 hour'
      `, [currentHour]);

      const data = metrics.rows[0];

      await this.db.query(`
        INSERT INTO analytics_hourly (
          timestamp,
          active_users,
          games_played,
          coins_earned,
          gems_earned
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (timestamp) DO UPDATE SET
          active_users = EXCLUDED.active_users,
          games_played = EXCLUDED.games_played,
          coins_earned = EXCLUDED.coins_earned,
          gems_earned = EXCLUDED.gems_earned
      `, [
        currentHour,
        parseInt(data.active_users) || 0,
        parseInt(data.games_played) || 0,
        parseInt(data.coins_earned) || 0,
        parseInt(data.gems_earned) || 0
      ]);

      this.stats.hourly_aggregations++;

      logger.info('✅ Hourly metrics aggregated', {
        hour: currentHour.toISOString(),
        active_users: data.active_users
      });

      return { success: true };

    } catch (error) {
      logger.error('💥 Error aggregating hourly metrics', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get aggregator statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      last_aggregation_ago_minutes: this.stats.last_aggregation
        ? Math.floor((Date.now() - this.stats.last_aggregation.getTime()) / 60000)
        : null
    };
  }
}

module.exports = AnalyticsAggregator;

