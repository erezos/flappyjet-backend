/**
 * Event Queue Service
 * Uses Bull (Redis-backed queue) to decouple event ingestion from processing
 * 
 * Benefits:
 * - Prevents backpressure on HTTP handlers
 * - Automatic retries with exponential backoff
 * - Job prioritization (game_ended events first)
 * - Concurrent workers (10 parallel)
 * - Persistent queue (survives restarts)
 * 
 * At 100K DAU with 20 events/user/day = 2M events/day
 * = ~1,400 events/min = ~23 events/second
 * 
 * With 10 workers processing ~100ms each = 100 events/second capacity
 */

const Queue = require('bull');
const logger = require('../utils/logger');
const EventProcessor = require('./event-processor');

class EventQueue {
  constructor(redis, db) {
    this.db = db;
    this.processor = new EventProcessor(db);
    
    // Create queue with Redis
    this.queue = new Queue('events', {
      redis: redis || process.env.REDIS_URL,
      defaultJobOptions: {
        attempts: 3,              // Retry failed jobs 3 times
        backoff: {
          type: 'exponential',
          delay: 2000             // 2s, 4s, 8s
        },
        removeOnComplete: true,   // Clean up after success
        removeOnFail: false       // Keep failed jobs for debugging
      },
      settings: {
        lockDuration: 30000,      // 30s lock per job
        stalledInterval: 30000,   // Check for stalled jobs every 30s
        maxStalledCount: 3        // Max times a job can be stalled
      }
    });

    // Process events with 10 concurrent workers
    this.queue.process(10, async (job) => {
      return await this.processJob(job);
    });

    // Event listeners for monitoring
    this.setupEventListeners();

    // Stats tracking
    this.stats = {
      total_queued: 0,
      total_processed: 0,
      total_failed: 0,
      last_processed: null
    };
  }

  /**
   * Add event to queue
   * @param {Object} event - Event object from Flutter
   * @param {Object} options - Queue options (priority, delay)
   * @returns {Promise<Job>}
   */
  async addEvent(event, options = {}) {
    try {
      // Determine priority (lower number = higher priority)
      let priority = 5; // Default priority
      
      if (event.event_type === 'game_ended') {
        priority = 1; // Highest priority (updates leaderboards)
      } else if (event.event_type === 'level_completed') {
        priority = 2;
      } else if (event.event_type === 'currency_earned' || event.event_type === 'currency_spent') {
        priority = 2;
      } else if (event.event_type === 'app_installed' || event.event_type === 'app_launched') {
        priority = 3;
      }

      const job = await this.queue.add(
        event,
        {
          priority,
          ...options
        }
      );

      this.stats.total_queued++;
      
      logger.debug('📦 Event queued', {
        job_id: job.id,
        event_type: event.event_type,
        user_id: event.user_id,
        priority
      });

      return job;
    } catch (error) {
      logger.error('❌ Error queuing event', {
        event_type: event.event_type,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Add batch of events to queue
   * @param {Array} events - Array of event objects
   * @returns {Promise<Array<Job>>}
   */
  async addBatch(events) {
    try {
      const jobs = await Promise.all(
        events.map(event => this.addEvent(event))
      );

      logger.info('📦 Batch queued', { count: events.length });
      
      return jobs;
    } catch (error) {
      logger.error('❌ Error queuing batch', {
        count: events.length,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process a job (called by Bull worker)
   * @param {Job} job - Bull job object
   * @returns {Promise<Object>}
   */
  async processJob(job) {
    const startTime = Date.now();
    const event = job.data;

    try {
      logger.debug('⚙️ Processing event job', {
        job_id: job.id,
        event_type: event.event_type,
        attempt: job.attemptsMade + 1
      });

      // Process event using EventProcessor
      const result = await this.processor.processEvent(event);

      if (!result.success) {
        // Validation error - don't retry
        logger.warn('❌ Event validation failed', {
          job_id: job.id,
          event_type: event.event_type,
          error: result.error
        });
        
        this.stats.total_failed++;
        
        // Return error but don't throw (prevents retry)
        return {
          success: false,
          error: result.error,
          should_retry: false
        };
      }

      const duration = Date.now() - startTime;
      
      this.stats.total_processed++;
      this.stats.last_processed = new Date();

      logger.info('✅ Event processed', {
        job_id: job.id,
        event_id: result.event_id,
        event_type: event.event_type,
        duration_ms: duration
      });

      return {
        success: true,
        event_id: result.event_id,
        duration_ms: duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('💥 Error processing event job', {
        job_id: job.id,
        event_type: event.event_type,
        attempt: job.attemptsMade + 1,
        error: error.message,
        duration_ms: duration
      });

      this.stats.total_failed++;

      // Throw error to trigger retry
      throw error;
    }
  }

  /**
   * Set up event listeners for monitoring
   */
  setupEventListeners() {
    // Job completed
    this.queue.on('completed', (job, result) => {
      logger.debug('✅ Job completed', {
        job_id: job.id,
        event_type: job.data.event_type,
        result
      });
    });

    // Job failed
    this.queue.on('failed', (job, error) => {
      logger.error('❌ Job failed', {
        job_id: job.id,
        event_type: job.data.event_type,
        attempts: job.attemptsMade,
        error: error.message
      });
    });

    // Job stalled (worker died)
    this.queue.on('stalled', (job) => {
      logger.warn('⚠️ Job stalled', {
        job_id: job.id,
        event_type: job.data.event_type
      });
    });

    // Queue error
    this.queue.on('error', (error) => {
      logger.error('💥 Queue error', { error: error.message });
    });
  }

  /**
   * Get queue statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    const counts = await this.queue.getJobCounts();
    
    return {
      ...this.stats,
      queue: {
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed
      },
      workers: 10,
      capacity_per_second: 100, // 10 workers * 10 events/second each
      current_load_percent: (counts.active / 10) * 100
    };
  }

  /**
   * Pause queue (for maintenance)
   */
  async pause() {
    await this.queue.pause();
    logger.warn('⏸️ Event queue paused');
  }

  /**
   * Resume queue
   */
  async resume() {
    await this.queue.resume();
    logger.info('▶️ Event queue resumed');
  }

  /**
   * Clean up old completed jobs
   * @param {number} grace - Grace period in milliseconds (default: 1 hour)
   */
  async cleanup(grace = 3600000) {
    const cleaned = await this.queue.clean(grace, 'completed');
    logger.info('🧹 Queue cleaned', { jobs_removed: cleaned.length });
    return cleaned.length;
  }

  /**
   * Close queue (for graceful shutdown)
   */
  async close() {
    await this.queue.close();
    logger.info('🔴 Event queue closed');
  }
}

module.exports = EventQueue;

