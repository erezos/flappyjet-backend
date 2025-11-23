/**
 * Leaderboard Aggregator Service
 * Processes game_ended events and updates leaderboards
 * 
 * This service:
 * 1. Reads unprocessed game_ended events
 * 2. Updates global leaderboard (endless mode)
 * 3. Updates tournament leaderboards (endless mode in tournament period)
 * 4. Updates Redis cache
 * 5. Marks events as processed
 * 
 * Called by cron jobs:
 * - Global: Every 5 minutes
 * - Tournament: Every 2 minutes
 */

const logger = require('../utils/logger');

class LeaderboardAggregator {
  constructor(db, cacheManager) {
    this.db = db;
    this.cache = cacheManager;
    this.stats = {
      global_updates: 0,
      tournament_updates: 0,
      last_global_update: null,
      last_tournament_update: null,
    };
  }

  /**
   * Update global leaderboard from game_ended events
   * Called every 5 minutes by cron
   * @returns {Promise<Object>} - { success, processed, errors }
   */
  async updateGlobalLeaderboard() {
    const startTime = Date.now();
    
    try {
      logger.info('🏆 Starting global leaderboard update...');

      // 1. Find unprocessed game_ended events (endless mode only)
      const eventsQuery = `
        SELECT id, user_id, payload
        FROM events
        WHERE event_type = 'game_ended'
          AND processed_at IS NULL
          AND (payload->>'game_mode')::text = 'endless'
        ORDER BY received_at ASC
        LIMIT 1000
      `;

      const events = await this.db.query(eventsQuery);
      
      if (events.rows.length === 0) {
        logger.info('✅ No new game_ended events to process');
        return { success: true, processed: 0 };
      }

      logger.info(`📊 Processing ${events.rows.length} game_ended events for global leaderboard`);

      let processed = 0;
      let errors = 0;

      // 2. Update leaderboard for each event
      for (const event of events.rows) {
        try {
          const payload = event.payload;
          const score = payload.score;
          const user_id = event.user_id;
          const duration_seconds = payload.duration_seconds || 0;

          // Upsert leaderboard entry (update high score if better)
          await this.db.query(`
            INSERT INTO leaderboard_global (
              user_id, 
              high_score, 
              total_games, 
              total_playtime_seconds,
              last_played_at, 
              updated_at
            )
            VALUES ($1, $2, 1, $3, NOW(), NOW())
            ON CONFLICT (user_id) DO UPDATE SET
              high_score = GREATEST(leaderboard_global.high_score, EXCLUDED.high_score),
              total_games = leaderboard_global.total_games + 1,
              total_playtime_seconds = leaderboard_global.total_playtime_seconds + EXCLUDED.total_playtime_seconds,
              last_played_at = NOW(),
              updated_at = CASE 
                WHEN EXCLUDED.high_score > leaderboard_global.high_score THEN NOW()
                ELSE leaderboard_global.updated_at
              END
          `, [user_id, score, duration_seconds]);

          // Mark event as processed
          await this.db.query(`
            UPDATE events 
            SET processed_at = NOW(), 
                processing_attempts = processing_attempts + 1
            WHERE id = $1
          `, [event.id]);

          processed++;

        } catch (error) {
          errors++;
          logger.error('❌ Error processing event for global leaderboard', {
            event_id: event.id,
            error: error.message
          });

          // Mark processing error
          await this.db.query(`
            UPDATE events 
            SET processing_attempts = processing_attempts + 1,
                processing_error = $1
            WHERE id = $2
          `, [error.message, event.id]);
        }
      }

      // 3. Update Redis cache with top 100
      await this.updateLeaderboardCache();

      // 4. Update cache metadata
      await this.db.query(`
        INSERT INTO leaderboard_cache_metadata (cache_key, last_updated_at, entry_count)
        VALUES ('global_top100', NOW(), (SELECT COUNT(*) FROM leaderboard_global))
        ON CONFLICT (cache_key) DO UPDATE SET
          last_updated_at = NOW(),
          entry_count = EXCLUDED.entry_count
      `);

      const duration = Date.now() - startTime;
      this.stats.global_updates++;
      this.stats.last_global_update = new Date();

      logger.info(`✅ Global leaderboard updated`, { 
        processed,
        errors,
        duration_ms: duration
      });

      return {
        success: true,
        processed,
        errors,
        duration_ms: duration
      };

    } catch (error) {
      logger.error('💥 Error updating global leaderboard', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Update tournament leaderboard from game_ended events in tournament period
   * Called every 2 minutes by cron
   * @param {string} tournamentId - Tournament identifier
   * @param {string} startDate - Tournament start date (ISO string)
   * @param {string} endDate - Tournament end date (ISO string)
   * @returns {Promise<Object>} - { success, processed, errors }
   */
  async updateTournamentLeaderboard(tournamentId, startDate, endDate) {
    const startTime = Date.now();
    
    try {
      logger.info('🏆 Starting tournament leaderboard update', { tournamentId });

      // 1. Find game_ended events in tournament period (endless mode only)
      //    that haven't been processed for this tournament yet
      const eventsQuery = `
        SELECT e.id, e.user_id, e.payload
        FROM events e
        WHERE e.event_type = 'game_ended'
          AND (e.payload->>'game_mode')::text = 'endless'
          AND e.received_at BETWEEN $1 AND $2
          AND NOT EXISTS (
            SELECT 1 FROM tournament_events te
            WHERE te.tournament_id = $3 AND te.event_id = e.id
          )
        ORDER BY e.received_at ASC
        LIMIT 1000
      `;

      const events = await this.db.query(eventsQuery, [startDate, endDate, tournamentId]);

      if (events.rows.length === 0) {
        logger.info('✅ No new tournament events to process', { tournamentId });
        return { success: true, processed: 0 };
      }

      logger.info(`📊 Processing ${events.rows.length} events for tournament ${tournamentId}`);

      let processed = 0;
      let errors = 0;

      // 2. Update tournament leaderboard for each event
      for (const event of events.rows) {
        try {
          const payload = event.payload;
          const score = payload.score;
          const user_id = event.user_id;

          // Upsert tournament leaderboard entry (update best score if better)
          await this.db.query(`
            INSERT INTO tournament_leaderboard (
              tournament_id,
              user_id,
              best_score,
              total_attempts,
              first_attempt_at,
              last_attempt_at
            )
            VALUES ($1, $2, $3, 1, NOW(), NOW())
            ON CONFLICT (tournament_id, user_id) DO UPDATE SET
              best_score = GREATEST(tournament_leaderboard.best_score, EXCLUDED.best_score),
              total_attempts = tournament_leaderboard.total_attempts + 1,
              last_attempt_at = NOW()
          `, [tournamentId, user_id, score]);

          // Mark event as processed for this tournament
          await this.db.query(`
            INSERT INTO tournament_events (tournament_id, event_id, processed_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (tournament_id, event_id) DO NOTHING
          `, [tournamentId, event.id]);

          processed++;

        } catch (error) {
          errors++;
          logger.error('❌ Error processing event for tournament leaderboard', {
            event_id: event.id,
            tournament_id: tournamentId,
            error: error.message
          });
        }
      }

      // 3. Update tournament cache
      await this.updateTournamentCache(tournamentId);

      const duration = Date.now() - startTime;
      this.stats.tournament_updates++;
      this.stats.last_tournament_update = new Date();

      logger.info(`✅ Tournament leaderboard updated`, {
        tournamentId,
        processed,
        errors,
        duration_ms: duration
      });

      return {
        success: true,
        processed,
        errors,
        duration_ms: duration
      };

    } catch (error) {
      logger.error('💥 Error updating tournament leaderboard', { 
        error: error.message,
        tournamentId 
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Update Redis cache with top 100 global players
   * @returns {Promise<void>}
   */
  async updateLeaderboardCache() {
    try {
      const top100 = await this.db.query(`
        SELECT 
          user_id,
          nickname,
          high_score,
          total_games,
          last_played_at,
          ROW_NUMBER() OVER (ORDER BY high_score DESC, last_played_at DESC) as rank
        FROM leaderboard_global
        ORDER BY high_score DESC, last_played_at DESC
        LIMIT 100
      `);

      // Store in Redis with 5 minute TTL
      await this.cache.set(
        'leaderboard:global:top100',
        JSON.stringify(top100.rows),
        300
      );

      logger.info('📦 Leaderboard cache updated', { entries: top100.rows.length });

    } catch (error) {
      logger.error('❌ Error updating leaderboard cache', { error: error.message });
      // Don't throw - cache failure shouldn't stop aggregation
    }
  }

  /**
   * Update Redis cache for tournament leaderboard
   * @param {string} tournamentId - Tournament identifier
   * @returns {Promise<void>}
   */
  async updateTournamentCache(tournamentId) {
    try {
      const top50 = await this.db.query(`
        SELECT 
          user_id,
          nickname,
          best_score,
          total_attempts,
          last_attempt_at,
          ROW_NUMBER() OVER (ORDER BY best_score DESC, last_attempt_at DESC) as rank
        FROM tournament_leaderboard
        WHERE tournament_id = $1
        ORDER BY best_score DESC, last_attempt_at DESC
        LIMIT 50
      `, [tournamentId]);

      // Store in Redis with 2 minute TTL (tournaments update more frequently)
      await this.cache.set(
        `tournament:${tournamentId}:leaderboard`,
        JSON.stringify(top50.rows),
        120
      );

      logger.info('📦 Tournament cache updated', { 
        tournamentId,
        entries: top50.rows.length 
      });

    } catch (error) {
      logger.error('❌ Error updating tournament cache', { 
        error: error.message,
        tournamentId 
      });
      // Don't throw - cache failure shouldn't stop aggregation
    }
  }

  /**
   * Get aggregator statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      uptime_minutes: this.stats.last_global_update 
        ? Math.floor((Date.now() - this.stats.last_global_update.getTime()) / 60000)
        : null
    };
  }

  /**
   * Clear all leaderboard caches
   * Useful for debugging or manual refresh
   * @returns {Promise<Object>}
   */
  async clearAllCaches() {
    try {
      logger.info('🗑️ Clearing all leaderboard caches...');

      await this.cache.delete('leaderboard:global:top100');
      
      // Clear tournament caches (would need to iterate all tournaments)
      // For now, they'll expire naturally (2 min TTL)

      logger.info('✅ Caches cleared');
      return { success: true };

    } catch (error) {
      logger.error('❌ Error clearing caches', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get global leaderboard with pagination
   * Used by API routes to serve leaderboard data
   * 
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of entries to return
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.requestingPlayerId - Optional player ID to include their position
   * @returns {Promise<Object>} - { success, leaderboard, userPosition }
   */
  async getGlobalLeaderboard({ limit = 15, offset = 0, requestingPlayerId = null }) {
    try {
      // Get leaderboard entries with ranks
      const leaderboardQuery = `
        SELECT 
          lg.user_id,
          lg.nickname,
          lg.high_score as score,
          lg.last_played_at as timestamp,
          ROW_NUMBER() OVER (ORDER BY lg.high_score DESC, lg.last_played_at DESC) as rank
        FROM leaderboard_global lg
        ORDER BY lg.high_score DESC, lg.last_played_at DESC
        LIMIT $1 OFFSET $2
      `;

      const leaderboardResult = await this.db.query(leaderboardQuery, [limit, offset]);
      
      const leaderboard = leaderboardResult.rows.map(row => ({
        rank: parseInt(row.rank) + offset, // Adjust rank for offset
        user_id: row.user_id,
        nickname: row.nickname || 'Anonymous',
        score: parseInt(row.score) || 0,
        timestamp: row.timestamp ? new Date(row.timestamp).getTime() : Date.now(),
        jet_skin: null, // Column doesn't exist in leaderboard_global table
        theme: null, // Column doesn't exist in leaderboard_global table
      }));

      // Get user's position if requested
      let userPosition = null;
      if (requestingPlayerId) {
        const userRankQuery = `
          SELECT 
            lg.user_id,
            lg.nickname,
            lg.high_score as score,
            lg.last_played_at as timestamp,
            (SELECT COUNT(*) + 1 
             FROM leaderboard_global lg2 
             WHERE lg2.high_score > lg.high_score 
                OR (lg2.high_score = lg.high_score AND lg2.last_played_at > lg.last_played_at)
            ) as rank
          FROM leaderboard_global lg
          WHERE lg.user_id = $1
          LIMIT 1
        `;

        const userResult = await this.db.query(userRankQuery, [requestingPlayerId]);
        
        if (userResult.rows.length > 0) {
          const row = userResult.rows[0];
          userPosition = {
            rank: parseInt(row.rank),
            user_id: row.user_id,
            nickname: row.nickname || 'Anonymous',
            score: parseInt(row.score) || 0,
            timestamp: row.timestamp ? new Date(row.timestamp).getTime() : Date.now(),
            jet_skin: null, // Column doesn't exist in leaderboard_global table
            theme: null, // Column doesn't exist in leaderboard_global table
          };
        }
      }

      return {
        success: true,
        leaderboard,
        userPosition,
      };
    } catch (error) {
      logger.error('❌ Error getting global leaderboard', {
        error: error.message,
        stack: error.stack,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Rebuild entire global leaderboard from scratch
   * WARNING: This is expensive! Only use for migrations or major fixes
   * @returns {Promise<Object>}
   */
  async rebuildGlobalLeaderboard() {
    try {
      logger.warn('⚠️ REBUILDING ENTIRE GLOBAL LEADERBOARD - This may take a while!');

      // Truncate existing leaderboard
      await this.db.query('TRUNCATE leaderboard_global');

      // Rebuild from all game_ended events (endless mode)
      await this.db.query(`
        INSERT INTO leaderboard_global (user_id, high_score, total_games, total_playtime_seconds, last_played_at, updated_at)
        SELECT 
          user_id,
          MAX((payload->>'score')::int) as high_score,
          COUNT(*) as total_games,
          SUM((payload->>'duration_seconds')::int) as total_playtime_seconds,
          MAX(received_at) as last_played_at,
          NOW() as updated_at
        FROM events
        WHERE event_type = 'game_ended'
          AND (payload->>'game_mode')::text = 'endless'
        GROUP BY user_id
      `);

      // Update cache
      await this.updateLeaderboardCache();

      logger.info('✅ Global leaderboard rebuilt successfully');
      return { success: true };

    } catch (error) {
      logger.error('💥 Error rebuilding global leaderboard', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = LeaderboardAggregator;

