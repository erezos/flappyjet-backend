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
      
      logger.info('✅ Event processed', { 
        event_id: eventId,
        event_type: event.event_type,
        user_id: event.user_id
      });

      // 3. Return success immediately (fire-and-forget)
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
    const query = `
      INSERT INTO events (event_type, user_id, payload, received_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id
    `;

    const values = [
      event.event_type,
      event.user_id,
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
   * Process a batch of events
   * @param {Array<Object>} events - Array of event objects
   * @returns {Promise<Object>} - { success, processed, failed, results }
   */
  async processBatch(events) {
    logger.info('📦 Processing event batch', { count: events.length });

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

    logger.info('📊 Batch processing complete', { 
      total: events.length,
      successful,
      failed,
      success_rate: ((successful / events.length) * 100).toFixed(2) + '%'
    });

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

