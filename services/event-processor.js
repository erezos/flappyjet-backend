/**
 * Event Processor Service
 * Validates and stores events from Flutter app
 * 
 * This service:
 * 1. Validates events against Joi schemas
 * 2. Stores raw events in PostgreSQL
 * 3. Returns immediately (fire-and-forget)
 * 4. Handles batch processing
 */

const logger = require('../utils/logger');
const { validateEvent } = require('./event-schemas');

class EventProcessor {
  constructor(db) {
    this.db = db;
    this.stats = {
      total_received: 0,
      total_processed: 0,
      total_invalid: 0,
      total_errors: 0,
    };
  }

  /**
   * Process a single event
   * @param {Object} event - Event object from Flutter
   * @returns {Promise<Object>} - { success, error?, event_id? }
   */
  async processEvent(event) {
    try {
      this.stats.total_received++;

      // 1. Normalize event data (fix common issues before validation)
      if (event.event_type === 'game_ended' && typeof event.hearts_remaining === 'number') {
        // Clamp hearts_remaining to 0 if negative (game over = 0 hearts)
        event.hearts_remaining = Math.max(0, event.hearts_remaining);
      }

      // 2. Validate event schema
      const validation = validateEvent(event);
      
      if (!validation.valid) {
        this.stats.total_invalid++;
        logger.warn('❌ Invalid event', { 
          event_type: event.event_type,
          user_id: event.user_id,
          errors: validation.errors 
        });
        
        return { 
          success: false, 
          error: 'Invalid event schema', 
          details: validation.errors 
        };
      }

      // 3. Store raw event in database
      const eventId = await this.storeEvent(event);
      
      this.stats.total_processed++;
      
      // ✅ REDUCED LOGGING: Only log important events to avoid Railway rate limits
      // Sample 1% of routine events for debugging
      const importantEvents = ['user_installed', 'level_completed', 'achievement_unlocked', 'purchase_completed'];
      if (importantEvents.includes(event.event_type)) {
        logger.info('✅ Important event processed', { 
          event_type: event.event_type,
          user_id: event.user_id?.substring(0, 8) + '...'
        });
      } else if (Math.random() < 0.01) {
        logger.debug('✅ Event processed (sampled)', { event_type: event.event_type });
      }

      // 4. ✅ SPECIAL HANDLING: Update users table for certain events
      // This ensures authoritative data is synced for push notifications
      await this._handleSpecialEvents(event);

      // 5. Return success immediately (fire-and-forget)
      return { 
        success: true, 
        event_id: eventId 
      };

    } catch (error) {
      this.stats.total_errors++;
      logger.error('💥 Error processing event', { 
        event_type: event?.event_type,
        user_id: event?.user_id,
        error: error.message,
        stack: error.stack
      });
      
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Store event in database
   * @param {Object} event - Validated event object
   * @returns {Promise<string>} - Event ID (UUID)
   */
  async storeEvent(event) {
    // ✅ Extract campaign_id from event payload (enriched by Flutter EventBus)
    const campaignId = event.campaign_id || null;
    
    const query = `
      INSERT INTO events (event_type, user_id, campaign_id, payload, received_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `;

    const values = [
      event.event_type,
      event.user_id,
      campaignId,
      JSON.stringify(event) // Store entire event as JSONB
    ];

    try {
      const result = await this.db.query(query, values);
      const eventId = result.rows[0].id;
      
      logger.debug('📝 Event stored in database', { 
        event_id: eventId,
        event_type: event.event_type 
      });
      
      return eventId;
    } catch (error) {
      logger.error('❌ Database error storing event', {
        event_type: event.event_type,
        user_id: event.user_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle special events that need additional processing
   * ✅ CRITICAL: Updates authoritative data (e.g., users table) for certain events
   * This ensures push notification personalization uses correct data
   * 
   * @param {Object} event - Processed event object
   */
  async _handleSpecialEvents(event) {
    try {
      switch (event.event_type) {
        case 'nickname_changed':
          // ✅ Update users table with new nickname (authoritative source for push notifications)
          await this._updateUserNickname(event.user_id, event.new_nickname);
          break;
        
        case 'user_installed':
        case 'app_installed':
          // ✅ FIXED: Also store user_installed events in user_acquisitions
          // This ensures all installs are tracked, even if user_acquired event isn't fired
          await this._storeUserAcquisitionFromInstall(event);
          // Update user's nickname if provided in payload
          if (event.nickname) {
            await this._updateUserNickname(event.user_id, event.nickname);
          }
          break;
        
        case 'app_launched':
          // Update user's nickname if provided in payload (for app launches)
          if (event.nickname) {
            await this._updateUserNickname(event.user_id, event.nickname);
          }
          break;
        
        case 'user_acquired':
          // ✅ NEW: Store campaign attribution data in user_acquisitions table
          await this._storeUserAcquisition(event);
          break;
        
        case 'user_installed':
        case 'app_installed':
          // ✅ FIXED: Also store user_installed events in user_acquisitions
          // This ensures all installs are tracked, even if user_acquired event isn't fired
          await this._storeUserAcquisitionFromInstall(event);
          break;
        
        case 'performance_metrics':
        case 'app_load_time':
        case 'game_load_time':
        case 'memory_usage':
          // ✅ NEW: Store performance metrics
          await this._storePerformanceMetric(event);
          break;
        
        case 'app_crashed':
        case 'app_error':
          // ✅ NEW: Store crash/error logs
          await this._storeCrashLog(event);
          break;
      }
    } catch (error) {
      // Don't fail the event processing if special handling fails
      // Just log the error - the event is already stored
      logger.error('⚠️ Special event handling failed (non-blocking)', {
        event_type: event.event_type,
        user_id: event.user_id,
        error: error?.message || error?.toString() || 'Unknown error',
        errorCode: error?.code,
        stack: error?.stack,
        // Include full error object for debugging (serialized safely)
        errorDetails: error ? {
          name: error.name,
          message: error.message,
          code: error.code,
          status: error.status,
          statusCode: error.statusCode,
        } : null,
      });
    }
  }

  /**
   * Update user's nickname in the users table
   * ✅ CRITICAL: This is the authoritative source for push notification personalization
   * 
   * @param {string} userId - User ID
   * @param {string} nickname - New nickname
   */
  async _updateUserNickname(userId, nickname) {
    if (!userId || !nickname) return;

    const cleanNickname = nickname.trim();
    if (cleanNickname.length < 2 || cleanNickname.length > 20) {
      logger.warn('⚠️ Invalid nickname length, skipping update', { userId, nickname });
      return;
    }

    try {
      const result = await this.db.query(`
        UPDATE users 
        SET nickname = $1, last_seen = NOW()
        WHERE user_id = $2
        RETURNING user_id
      `, [cleanNickname, userId]);

      if (result.rows.length > 0) {
        logger.info('✅ User nickname updated', { 
          user_id: userId, 
          nickname: cleanNickname,
          message: 'Push notifications will now use this nickname'
        });
      } else {
        // User doesn't exist in users table yet - create them
        await this.db.query(`
          INSERT INTO users (user_id, nickname, created_at, last_seen)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            nickname = EXCLUDED.nickname,
            last_seen = NOW()
        `, [userId, cleanNickname]);
        
        logger.info('✅ User created with nickname', { 
          user_id: userId, 
          nickname: cleanNickname 
        });
      }
    } catch (error) {
      logger.error('❌ Failed to update user nickname', {
        user_id: userId,
        nickname: cleanNickname,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process a batch of events
   * @param {Array<Object>} events - Array of event objects
   * @returns {Promise<Object>} - { success, processed, failed, results }
   */
  async processBatch(events) {
    // ✅ REDUCED LOGGING: Only log large batches to avoid Railway rate limits
    if (events.length > 10) {
      logger.info('📦 Processing large event batch', { count: events.length });
    }

    const results = [];
    let successful = 0;
    let failed = 0;

    // Process events in parallel (for better performance)
    const promises = events.map(async (event, index) => {
      try {
        const result = await this.processEvent(event);
        
        if (result.success) {
          successful++;
        } else {
          failed++;
        }
        
        return {
          index,
          event_type: event.event_type,
          ...result
        };
      } catch (error) {
        failed++;
        return {
          index,
          event_type: event?.event_type || 'unknown',
          success: false,
          error: error.message
        };
      }
    });

    const batchResults = await Promise.all(promises);

    // ✅ REDUCED LOGGING: Only log if there are failures or large batches
    if (failed > 0 || events.length > 10) {
      logger.info('📊 Batch processing complete', { 
        total: events.length,
        successful,
        failed,
        success_rate: ((successful / events.length) * 100).toFixed(2) + '%'
      });
    }

    return {
      success: true,
      processed: successful,
      failed,
      results: batchResults
    };
  }

  /**
   * Process batch with transaction (all-or-nothing)
   * Useful for critical events that must all succeed
   * @param {Array<Object>} events - Array of event objects
   * @returns {Promise<Object>} - { success, processed, error? }
   */
  async processBatchTransaction(events) {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      logger.info('🔄 Processing batch in transaction', { count: events.length });
      
      let processed = 0;
      const results = [];
      
      for (const event of events) {
        // Validate
        const validation = validateEvent(event);
        
        if (!validation.valid) {
          throw new Error(`Invalid event: ${validation.errors.join(', ')}`);
        }
        
        // Store
        const query = `
          INSERT INTO events (event_type, user_id, payload, received_at)
          VALUES ($1, $2, $3, NOW())
          RETURNING id
        `;
        
        const values = [
          event.event_type,
          event.user_id,
          JSON.stringify(event)
        ];
        
        const result = await client.query(query, values);
        const eventId = result.rows[0].id;
        
        processed++;
        results.push({ event_id: eventId, event_type: event.event_type });
      }
      
      await client.query('COMMIT');
      
      logger.info('✅ Transaction batch complete', { processed });
      
      return {
        success: true,
        processed,
        results
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      
      logger.error('❌ Transaction batch failed', { error: error.message });
      
      return {
        success: false,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  /**
   * Store user acquisition data in user_acquisitions table
   * ✅ Called when user_acquired event is received
   * 
   * @param {Object} event - user_acquired event with campaign data
   */
  async _storeUserAcquisition(event) {
    try {
      const userId = event.user_id;
      const installDate = event.install_date ? new Date(event.install_date) : new Date();
      
      // Extract campaign data from event payload
      const campaignId = event.campaign_id || null;
      const source = event.source || null;
      const medium = event.medium || null;
      const campaign = event.campaign || null;
      const adGroup = event.ad_group || null;
      const adGroupId = event.ad_group_id || null;
      const keyword = event.keyword || null;
      const gclid = event.gclid || null;
      const creative = event.creative || null;
      const platform = event.platform || event.payload?.platform || null;
      const country = event.country || event.payload?.country || null;

      // Insert or update user acquisition record
      const query = `
        INSERT INTO user_acquisitions (
          user_id, install_date, campaign_id, source, medium, campaign,
          ad_group, ad_group_id, keyword, gclid, creative, platform, country
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (user_id) DO UPDATE SET
          campaign_id = COALESCE(EXCLUDED.campaign_id, user_acquisitions.campaign_id),
          source = COALESCE(EXCLUDED.source, user_acquisitions.source),
          medium = COALESCE(EXCLUDED.medium, user_acquisitions.medium),
          campaign = COALESCE(EXCLUDED.campaign, user_acquisitions.campaign),
          ad_group = COALESCE(EXCLUDED.ad_group, user_acquisitions.ad_group),
          ad_group_id = COALESCE(EXCLUDED.ad_group_id, user_acquisitions.ad_group_id),
          keyword = COALESCE(EXCLUDED.keyword, user_acquisitions.keyword),
          gclid = COALESCE(EXCLUDED.gclid, user_acquisitions.gclid),
          creative = COALESCE(EXCLUDED.creative, user_acquisitions.creative),
          platform = COALESCE(EXCLUDED.platform, user_acquisitions.platform),
          country = COALESCE(EXCLUDED.country, user_acquisitions.country)
      `;

      await this.db.query(query, [
        userId,
        installDate,
        campaignId,
        source,
        medium,
        campaign,
        adGroup,
        adGroupId,
        keyword,
        gclid,
        creative,
        platform,
        country
      ]);

      logger.info('✅ User acquisition stored', {
        user_id: userId?.substring(0, 8) + '...',
        campaign_id: campaignId,
        source: source
      });
    } catch (error) {
      logger.error('❌ Failed to store user acquisition', {
        user_id: event.user_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Store user acquisition from user_installed/app_installed event
   * ✅ FIXED: Ensures all installs are tracked, even if user_acquired event isn't fired
   * 
   * @param {Object} event - user_installed or app_installed event
   */
  async _storeUserAcquisitionFromInstall(event) {
    try {
      const userId = event.user_id;
      if (!userId) {
        logger.warn('⚠️ Missing user_id for user_installed event, skipping store');
        return;
      }

      const installDate = event.payload?.timestamp 
        ? new Date(event.payload.timestamp) 
        : new Date(event.received_at || new Date());
      
      // Extract campaign data from event payload (if available)
      const campaignId = event.campaign_id || event.payload?.campaign_id || null;
      const source = event.source || event.payload?.source || null;
      const medium = event.medium || event.payload?.medium || null;
      const campaign = event.campaign || event.payload?.campaign || null;
      const platform = event.platform || event.payload?.platform || null;
      const country = event.country || event.payload?.country || null;

      // Insert or update user acquisition record (only if not already exists)
      // Use ON CONFLICT DO NOTHING to avoid overwriting existing user_acquired data
      const query = `
        INSERT INTO user_acquisitions (
          user_id, install_date, campaign_id, source, medium, campaign,
          platform, country
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO NOTHING
      `;

      await this.db.query(query, [
        userId,
        installDate,
        campaignId,
        source,
        medium,
        campaign,
        platform,
        country
      ]);

      logger.debug('✅ User acquisition stored from install event', {
        user_id: userId?.substring(0, 8) + '...',
        campaign_id: campaignId || 'none'
      });
    } catch (error) {
      logger.error('❌ Failed to store user acquisition from install', {
        user_id: event.user_id,
        error: error.message
      });
      // Don't throw - this is non-critical
    }
  }

  /**
   * Store performance metrics in performance_metrics table
   * ✅ Called for performance_metrics, app_load_time, game_load_time, memory_usage events
   * 
   * @param {Object} event - Performance event with metrics data
   */
  async _storePerformanceMetric(event) {
    try {
      const userId = event.user_id;
      if (!userId) {
        logger.warn('⚠️ Performance metric missing user_id, skipping');
        return;
      }

      // Extract performance data from event payload
      const payload = event.payload || {};
      const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();

      // FPS metrics
      const fpsAverage = payload.fps_average || payload.fps || null;
      const fpsMin = payload.fps_min || null;
      const fpsMax = payload.fps_max || null;
      const fpsCurrent = payload.fps_current || null;

      // Load times (from specific event types or payload)
      let appLoadTime = null;
      let gameLoadTime = null;
      
      if (event.event_type === 'app_load_time') {
        appLoadTime = payload.load_time_ms || payload.app_load_time_ms || payload.duration_ms || null;
      } else if (event.event_type === 'game_load_time') {
        gameLoadTime = payload.load_time_ms || payload.game_load_time_ms || payload.duration_ms || null;
      } else {
        // From performance_metrics event
        appLoadTime = payload.app_load_time_ms || null;
        gameLoadTime = payload.game_load_time_ms || null;
      }

      // Memory usage
      const memoryMb = payload.memory_mb || payload.memory_usage_mb || null;
      const frameTimeMs = payload.frame_time_ms || null;

      // Device info
      const deviceModel = payload.device_model || event.device_model || null;
      const osVersion = payload.os_version || event.os_version || null;
      const platform = payload.platform || event.platform || null;

      // Only insert if we have at least one metric
      if (!fpsAverage && !appLoadTime && !gameLoadTime && !memoryMb) {
        logger.debug('⚠️ Performance metric has no data, skipping', { event_type: event.event_type });
        return;
      }

      const query = `
        INSERT INTO performance_metrics (
          user_id, timestamp, fps_average, fps_min, fps_max, fps_current,
          app_load_time_ms, game_load_time_ms, memory_mb, frame_time_ms,
          device_model, os_version, platform
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `;

      await this.db.query(query, [
        userId,
        timestamp,
        fpsAverage,
        fpsMin,
        fpsMax,
        fpsCurrent,
        appLoadTime,
        gameLoadTime,
        memoryMb,
        frameTimeMs,
        deviceModel,
        osVersion,
        platform
      ]);

      logger.debug('✅ Performance metric stored', {
        user_id: userId?.substring(0, 8) + '...',
        event_type: event.event_type,
        has_fps: !!fpsAverage,
        has_load_times: !!(appLoadTime || gameLoadTime),
        has_memory: !!memoryMb,
      });
    } catch (error) {
      logger.error('❌ Failed to store performance metric', {
        user_id: event.user_id,
        event_type: event.event_type,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Store crash/error logs in crash_logs table
   * ✅ Called for app_crashed, app_error events
   * 
   * @param {Object} event - Crash/error event with crash data
   */
  async _storeCrashLog(event) {
    try {
      const userId = event.user_id;
      if (!userId) {
        logger.warn('⚠️ Crash log missing user_id, skipping');
        return;
      }

      // Extract crash data from event payload
      const payload = event.payload || {};
      const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();

      // Crash type: determine from event_type or payload
      let crashType = 'error'; // default
      if (event.event_type === 'app_crashed') {
        crashType = payload.crash_type || 'crash';
      } else if (event.event_type === 'app_error') {
        crashType = payload.crash_type || 'error';
      }

      // Validate crash type
      const validTypes = ['fatal', 'error', 'exception', 'crash'];
      if (!validTypes.includes(crashType)) {
        crashType = 'error';
      }

      const crashMessage = payload.crash_message || payload.error_message || payload.message || 'Unknown error';
      const stackTrace = payload.stack_trace || payload.stack || null;
      const context = payload.context || payload.where || null;
      const fatal = payload.fatal || (crashType === 'fatal' || crashType === 'crash') || false;

      // Device info
      const deviceModel = payload.device_model || event.device_model || null;
      const osVersion = payload.os_version || event.os_version || null;
      const platform = payload.platform || event.platform || null;
      const appVersion = payload.app_version || event.app_version || null;

      const query = `
        INSERT INTO crash_logs (
          user_id, timestamp, crash_type, crash_message, stack_trace, context,
          device_model, os_version, platform, app_version, fatal
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;

      await this.db.query(query, [
        userId,
        timestamp,
        crashType,
        crashMessage,
        stackTrace,
        context,
        deviceModel,
        osVersion,
        platform,
        appVersion,
        fatal
      ]);

      logger.info('✅ Crash log stored', {
        user_id: userId?.substring(0, 8) + '...',
        crash_type: crashType,
        fatal: fatal,
        has_stack: !!stackTrace,
      });
    } catch (error) {
      logger.error('❌ Failed to store crash log', {
        user_id: event.user_id,
        event_type: event.event_type,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get processor statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      success_rate: this.stats.total_received > 0
        ? ((this.stats.total_processed / this.stats.total_received) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      total_received: 0,
      total_processed: 0,
      total_invalid: 0,
      total_errors: 0,
    };
    logger.info('📊 Statistics reset');
  }

  /**
   * Retry failed events
   * @param {number} limit - Max events to retry
   * @returns {Promise<Object>} - { success, retried, processed, failed }
   */
  async retryFailedEvents(limit = 100) {
    try {
      logger.info('🔄 Retrying failed events', { limit });
      
      // Get events that failed processing
      const query = `
        SELECT id, event_type, user_id, payload, processing_attempts
        FROM events
        WHERE processed_at IS NULL 
          AND processing_attempts > 0
          AND processing_attempts < 3  -- Max 3 retry attempts
        ORDER BY received_at ASC
        LIMIT $1
      `;
      
      const result = await this.db.query(query, [limit]);
      const failedEvents = result.rows;
      
      if (failedEvents.length === 0) {
        logger.info('✅ No failed events to retry');
        return { success: true, retried: 0 };
      }
      
      logger.info(`🔄 Found ${failedEvents.length} failed events to retry`);
      
      let processed = 0;
      let failed = 0;
      
      for (const row of failedEvents) {
        try {
          const event = row.payload;
          
          // Validate and reprocess
          const validation = validateEvent(event);
          
          if (validation.valid) {
            // Mark as processed
            await this.db.query(
              `UPDATE events 
               SET processed_at = NOW(),
                   processing_attempts = processing_attempts + 1,
                   processing_error = NULL
               WHERE id = $1`,
              [row.id]
            );
            
            processed++;
            logger.info('✅ Retry successful', { event_id: row.id });
          } else {
            // Mark retry failed
            await this.db.query(
              `UPDATE events 
               SET processing_attempts = processing_attempts + 1,
                   processing_error = $1
               WHERE id = $2`,
              [validation.errors.join(', '), row.id]
            );
            
            failed++;
            logger.warn('❌ Retry failed', { event_id: row.id, errors: validation.errors });
          }
        } catch (error) {
          failed++;
          logger.error('💥 Error during retry', { event_id: row.id, error: error.message });
        }
      }
      
      logger.info('📊 Retry complete', { 
        total: failedEvents.length,
        processed,
        failed 
      });
      
      return {
        success: true,
        retried: failedEvents.length,
        processed,
        failed
      };
      
    } catch (error) {
      logger.error('💥 Error retrying failed events', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = EventProcessor;

