/**
 * Events API Routes
 * Handles event ingestion from Flutter app
 * 
 * POST /api/events - Accept events (batch or single)
 * GET /api/events/stats - Get event ingestion stats
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EventProcessor = require('../services/event-processor');

/**
 * POST /api/events
 * Accept events from Flutter app (fire-and-forget)
 * 
 * Request body can be:
 * - Single event object: { event_type: '...', user_id: '...', ... }
 * - Batch array: [{ event_type: '...', ... }, { event_type: '...', ... }]
 * 
 * Response: Always 200 OK (fire-and-forget pattern)
 * Events are processed asynchronously
 */
router.post('/', async (req, res) => {
  try {
    let events = Array.isArray(req.body) ? req.body : [req.body];
    
    // ✅ LIMIT BATCH SIZE TO PREVENT MEMORY SPIKES
    const MAX_BATCH_SIZE = 100;
    if (events.length > MAX_BATCH_SIZE) {
      logger.warn(`⚠️ Batch too large: ${events.length}, truncating to ${MAX_BATCH_SIZE}`);
      events = events.slice(0, MAX_BATCH_SIZE);
    }
    
    logger.info('📥 Events received', { 
      count: events.length,
      from_ip: req.ip,
      user_agent: req.get('user-agent')
    });

    // ✅ Return 200 immediately (fire-and-forget pattern)
    // Flutter app doesn't need to wait for processing
    res.status(200).json({
      success: true,
      message: 'Events received',
      count: events.length,
      timestamp: new Date().toISOString()
    });

    // 🔥 Add events to queue (if available) or process directly
    const eventQueue = req.app.locals.eventQueue;
    
    if (eventQueue) {
      // Use queue for better scalability (100K+ DAU)
      eventQueue.addBatch(events).catch(error => {
        logger.error('💥 Error queuing events batch', { 
          error: error.message,
          count: events.length 
        });
      });
    } else {
      // Fallback: process directly (for <10K DAU or if Redis unavailable)
      const processor = new EventProcessor(req.app.locals.db);
      
      processor.processBatch(events).catch(error => {
        logger.error('💥 Error processing events batch', { 
          error: error.message,
          count: events.length 
        });
      });
    }

  } catch (error) {
    logger.error('❌ Error receiving events', { error: error.message });
    
    // Even on error, return 200 (fire-and-forget)
    // This prevents Flutter app from retrying unnecessarily
    res.status(200).json({
      success: true,
      message: 'Events acknowledged',
      note: 'Processing may have encountered issues'
    });
  }
});

/**
 * GET /api/events/stats
 * Get event ingestion statistics
 * Useful for monitoring and debugging
 */
router.get('/stats', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    const db = req.app.locals.db;

    // Calculate time range
    let interval = '24 hours';
    if (timeframe === '1h') interval = '1 hour';
    if (timeframe === '7d') interval = '7 days';
    if (timeframe === '30d') interval = '30 days';

    // Get event stats
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE processed_at IS NOT NULL) as processed_events,
        COUNT(*) FILTER (WHERE processed_at IS NULL) as pending_events,
        COUNT(*) FILTER (WHERE processing_error IS NOT NULL) as failed_events,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT event_type) as event_types,
        MIN(received_at) as first_event,
        MAX(received_at) as last_event,
        AVG(EXTRACT(EPOCH FROM (processed_at - received_at))) as avg_processing_time_seconds
      FROM events
      WHERE received_at > NOW() - INTERVAL '${interval}'
    `);

    // Get event type breakdown
    const eventTypes = await db.query(`
      SELECT 
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users
      FROM events
      WHERE received_at > NOW() - INTERVAL '${interval}'
      GROUP BY event_type
      ORDER BY count DESC
    `);

    // Get hourly distribution (last 24 hours)
    const hourly = await db.query(`
      SELECT 
        DATE_TRUNC('hour', received_at) as hour,
        COUNT(*) as count
      FROM events
      WHERE received_at > NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
    `);

    // Get queue stats (if available)
    let queueStats = null;
    const eventQueue = req.app.locals.eventQueue;
    if (eventQueue) {
      queueStats = await eventQueue.getStats();
    }

    res.json({
      success: true,
      timeframe: interval,
      summary: stats.rows[0],
      event_types: eventTypes.rows,
      hourly_distribution: hourly.rows,
      queue: queueStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error getting event stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/events/health
 * Health check endpoint for event ingestion system
 */
router.get('/health', async (req, res) => {
  try {
    const db = req.app.locals.db;

    // Check database connection
    await db.query('SELECT 1');

    // Check if events table exists
    const tableCheck = await db.query(`
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'events'
    `);

    if (tableCheck.rows.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Events table not found',
        status: 'unhealthy'
      });
    }

    // Check for recent events (last 5 minutes)
    const recentEvents = await db.query(`
      SELECT COUNT(*) as count
      FROM events
      WHERE received_at > NOW() - INTERVAL '5 minutes'
    `);

    // Check for stuck events (received but not processed for >1 hour)
    const stuckEvents = await db.query(`
      SELECT COUNT(*) as count
      FROM events
      WHERE received_at < NOW() - INTERVAL '1 hour'
        AND processed_at IS NULL
        AND processing_attempts < 3
    `);

    const health = {
      success: true,
      status: 'healthy',
      database: 'connected',
      events_table: 'exists',
      recent_events: parseInt(recentEvents.rows[0].count),
      stuck_events: parseInt(stuckEvents.rows[0].count),
      timestamp: new Date().toISOString()
    };

    // Warning if too many stuck events
    if (health.stuck_events > 1000) {
      health.status = 'degraded';
      health.warning = 'High number of stuck events - aggregators may be behind';
    }

    res.json(health);

  } catch (error) {
    logger.error('❌ Health check failed', { error: error.message });
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * POST /api/events/retry-failed
 * Manually trigger retry of failed events
 * Admin/debugging endpoint
 */
router.post('/retry-failed', async (req, res) => {
  try {
    const { limit = 100 } = req.body;
    const processor = new EventProcessor(req.app.locals.db);

    logger.info('🔄 Manual retry triggered', { limit });

    const result = await processor.retryFailedEvents(limit);

    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error during manual retry', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/events/recent
 * Get recent events for debugging
 * Limited to last 100 events
 */
router.get('/recent', async (req, res) => {
  try {
    const { limit = 100, event_type, user_id } = req.query;
    const db = req.app.locals.db;

    let query = `
      SELECT 
        id,
        event_type,
        user_id,
        received_at,
        processed_at,
        processing_attempts,
        processing_error
      FROM events
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (event_type) {
      query += ` AND event_type = $${paramCount}`;
      params.push(event_type);
      paramCount++;
    }

    if (user_id) {
      query += ` AND user_id = $${paramCount}`;
      params.push(user_id);
      paramCount++;
    }

    query += ` ORDER BY received_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);

    res.json({
      success: true,
      events: result.rows,
      count: result.rows.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error getting recent events', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

