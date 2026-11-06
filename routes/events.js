/**
 * Events API Routes
 * Handles event ingestion from Flutter app
 * 
 * POST /api/events - Accept events (batch or single)
 * GET /api/events/stats - Get event ingestion stats
 * 
 * Features:
 * - Server-side country detection via IP geolocation
 * - Redis caching of user countries (7-day TTL)
 * - PostgreSQL persistence for analytics
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const EventProcessor = require('../services/event-processor');
const GeolocationService = require('../services/geolocation-service');

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
  // ✅ FIX: Parse request body SYNCHRONOUSLY (no await)
  let events;
  try {
    if (Array.isArray(req.body)) {
      events = req.body;
    } else if (req.body.events && Array.isArray(req.body.events)) {
      events = req.body.events;
    } else {
      events = [req.body];
    }
    
    // Limit batch size
    const MAX_BATCH_SIZE = 100;
    if (events.length > MAX_BATCH_SIZE) {
      events = events.slice(0, MAX_BATCH_SIZE);
    }
  } catch (parseError) {
    events = [];
  }

  // ✅ CRITICAL FIX: Send response IMMEDIATELY (no blocking operations before this!)
  // This prevents 499 timeout errors from Railway
  res.status(200).json({
    success: true,
    message: 'Events received',
    count: events.length,
    timestamp: new Date().toISOString()
  });

  // ✅ Everything below runs AFTER response is sent (truly fire-and-forget)
  // Client has already received 200 OK at this point
  
  if (events.length === 0) {
    return; // Nothing to process
  }

  // 🌍 Server-side country detection (non-blocking, runs after response)
  const userId = events[0]?.user_id;
  let detectedCountry = null;
  
  if (userId) {
    try {
      const geoService = new GeolocationService(
        req.app.locals.redisClient, 
        req.app.locals.db
      );
      // ✅ Add timeout to prevent hanging on slow Redis
      const geoPromise = geoService.getCountryForUser(userId, req);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Geo lookup timeout')), 2000)
      );
      detectedCountry = await Promise.race([geoPromise, timeoutPromise]);
    } catch (geoError) {
      // Geo lookup failed or timed out - continue without country
      logger.debug(`🌍 GeoIP lookup failed: ${geoError.message}`);
    }
  }

  // Inject country into all events
  if (detectedCountry) {
    events = events.map(event => ({
      ...event,
      country: detectedCountry,
    }));
  }

  // ✅ Reduced logging to avoid Railway rate limits
  if (events.length > 10 || Math.random() < 0.01) {
    logger.debug('📥 Events processing', { count: events.length, country: detectedCountry || 'unknown' });
  }

  // 🔥 Process events (queue or direct)
  try {
    const eventQueue = req.app.locals.eventQueue;
    
    if (eventQueue) {
      await eventQueue.addBatch(events);
    } else {
      const processor = new EventProcessor(req.app.locals.db);
      await processor.processBatch(events);
    }
  } catch (error) {
    logger.error('💥 Error processing events batch', { 
      error: error.message,
      count: events.length 
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

/**
 * GET /api/events/scoreboard
 * Aggregate the events the app actually sends. Counts are split by app version.
 * Day-1 and day-7 are returning players, not session counts divided by installs.
 */
router.get('/scoreboard', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const recentStart = new Date(now.getTime() - 28 * day);
    const priorStart = new Date(now.getTime() - 56 * day);
    const focusVersion = '2.5.0';

    const recent = await scoreboardWindow(db, recentStart, now, null);
    const prior = await scoreboardWindow(db, priorStart, recentStart, null);
    const focusRecent = await scoreboardWindow(db, recentStart, now, focusVersion);
    const focusPrior = await scoreboardWindow(db, priorStart, recentStart, focusVersion);
    const byVersion = await scoreboardVersions(db, recentStart, now);

    const trusted = focusRecent.events > 0;
    res.json({
      generated_at: now.toISOString(),
      source: 'railway',
      trusted,
      focus_version: focusVersion,
      recent_28_days: focusRecent,
      prior_28_days: focusPrior,
      all_versions_recent_28_days: recent,
      all_versions_prior_28_days: prior,
      by_version: byVersion,
      note: trusted
        ? 'Counts are version 2.5.0 players from the Railway events table.'
        : 'Scoreboard untrusted: version 2.5.0 has no Railway events in the last 28 days.',
    });
  } catch (error) {
    logger.error('❌ Scoreboard query failed', { error: error.message });
    res.status(500).json({
      source: 'railway',
      trusted: false,
      error: 'Scoreboard untrusted',
    });
  }
});

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 1000;
}

async function scoreboardWindow(db, start, end, version) {
  const params = [start, end];
  let versionSql = '';
  if (version) {
    params.push(version);
    versionSql = `AND payload->>'app_version' = $3`;
  }
  const result = await db.query(
    `
    WITH ev AS (
      SELECT
        event_type,
        user_id,
        received_at,
        CASE
          WHEN payload->>'revenue_usd' ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (payload->>'revenue_usd')::numeric
          ELSE 0
        END AS revenue_usd
      FROM events
      WHERE received_at >= $1 AND received_at < $2
      ${versionSql}
    ),
    installs AS (
      SELECT user_id, MIN(received_at) AS installed_at
      FROM ev
      WHERE event_type IN ('user_installed', 'first_open', 'app_installed')
      GROUP BY user_id
    ),
    activity AS (
      SELECT DISTINCT user_id, (received_at AT TIME ZONE 'UTC')::date AS day
      FROM ev
      WHERE event_type IN ('session_started', 'app_launched', 'game_started')
    )
    SELECT
      (SELECT COUNT(*) FROM ev) AS events,
      (SELECT COUNT(*) FROM installs) AS installs,
      (SELECT COUNT(*) FROM ev WHERE event_type = 'session_started') AS session_started,
      (SELECT COUNT(*) FROM ev WHERE event_type = 'game_started') AS game_started,
      (SELECT COUNT(DISTINCT user_id) FROM ev WHERE event_type = 'game_started') AS players_who_started,
      (SELECT COUNT(*) FROM ev WHERE event_type = 'level_completed') AS level_completed,
      (SELECT COUNT(*) FROM ev WHERE event_type = 'level_failed') AS level_failed,
      (SELECT COUNT(*) FROM ev WHERE event_type = 'interstitial_shown') AS interstitial_shown,
      (SELECT COUNT(*) FROM ev WHERE event_type IN ('purchase_completed', 'iap_purchase_completed')) AS purchase_completed,
      (SELECT COUNT(*) FROM ev WHERE event_type IN ('purchase_acknowledged', 'iap_purchase_acknowledged')) AS purchase_acknowledged,
      (SELECT COUNT(*) FROM ev WHERE event_type ILIKE '%refund%') AS refunds,
      (SELECT COALESCE(SUM(revenue_usd), 0) FROM ev WHERE event_type = 'ad_revenue') AS ad_revenue_usd,
      (SELECT COALESCE(SUM(revenue_usd), 0) FROM ev WHERE event_type IN ('purchase_completed', 'iap_purchase_completed')) AS iap_revenue_usd,
      (SELECT COUNT(*) FROM installs i WHERE i.installed_at <= NOW() - INTERVAL '1 day') AS day1_eligible,
      (SELECT COUNT(*) FROM installs i
        WHERE i.installed_at <= NOW() - INTERVAL '1 day'
          AND EXISTS (
            SELECT 1 FROM activity a
            WHERE a.user_id = i.user_id
              AND a.day = (i.installed_at AT TIME ZONE 'UTC')::date + 1
          )) AS day1_retained,
      (SELECT COUNT(*) FROM installs i WHERE i.installed_at <= NOW() - INTERVAL '7 days') AS day7_eligible,
      (SELECT COUNT(*) FROM installs i
        WHERE i.installed_at <= NOW() - INTERVAL '7 days'
          AND EXISTS (
            SELECT 1 FROM activity a
            WHERE a.user_id = i.user_id
              AND a.day = (i.installed_at AT TIME ZONE 'UTC')::date + 7
          )) AS day7_retained
    `,
    params
  );
  const row = result.rows[0] || {};
  const installs = num(row.installs);
  const day1Eligible = num(row.day1_eligible);
  const day7Eligible = num(row.day7_eligible);
  const players = num(row.players_who_started);
  return {
    events: num(row.events),
    installs,
    session_started: num(row.session_started),
    game_started: num(row.game_started),
    plays_per_player: rate(num(row.game_started), players),
    level_completed: num(row.level_completed),
    level_failed: num(row.level_failed),
    interstitial_shown: num(row.interstitial_shown),
    purchase_completed: num(row.purchase_completed),
    purchase_acknowledged: num(row.purchase_acknowledged),
    refunds: num(row.refunds),
    ad_revenue_usd: num(row.ad_revenue_usd),
    iap_revenue_usd: num(row.iap_revenue_usd),
    day1_eligible: day1Eligible,
    day1_retained: num(row.day1_retained),
    day1_rate: rate(num(row.day1_retained), day1Eligible),
    day7_eligible: day7Eligible,
    day7_retained: num(row.day7_retained),
    day7_rate: rate(num(row.day7_retained), day7Eligible),
    app_version: version || 'all',
  };
}

async function scoreboardVersions(db, start, end) {
  const result = await db.query(
    `
    SELECT COALESCE(payload->>'app_version', 'unknown') AS app_version,
           COUNT(*) AS events,
           COUNT(DISTINCT user_id) AS players
    FROM events
    WHERE received_at >= $1 AND received_at < $2
    GROUP BY 1
    ORDER BY events DESC
    LIMIT 20
    `,
    [start, end]
  );
  return result.rows.map((row) => ({
    app_version: row.app_version,
    events: num(row.events),
    players: num(row.players),
  }));
}

module.exports = router;

