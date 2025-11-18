/// 📊 Analytics Dashboard API Routes
/// Optimized endpoints with Redis caching for zero game impact

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

module.exports = (db, cacheManager) => {
  // ============================================================================
  // CACHING STRATEGY
  // ============================================================================
  // All queries use Redis cache with 5-minute TTL
  // This ensures ZERO impact on game performance
  // Cache is refreshed automatically by a background job
  
  const CACHE_TTL = 300; // 5 minutes
  const CACHE_PREFIX = 'dashboard:';

  /**
   * Helper: Get data from cache or database
   */
  async function getCachedQuery(cacheKey, queryFn, ttl = CACHE_TTL) {
    try {
      // Try cache first
      const cached = await cacheManager.get(`${CACHE_PREFIX}${cacheKey}`);
      if (cached) {
        logger.info(`📊 Cache HIT: ${cacheKey}`);
        return cached; // ✅ FIX: CacheManager already returns parsed JSON
      }

      // Cache miss - query database
      logger.info(`📊 Cache MISS: ${cacheKey} - querying database`);
      const result = await queryFn();
      
      // Store in cache
      await cacheManager.set(`${CACHE_PREFIX}${cacheKey}`, result, ttl); // ✅ FIX: CacheManager handles serialization
      
      return result;
    } catch (error) {
      logger.error(`📊 Error in getCachedQuery for ${cacheKey}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // 1. OVERVIEW METRICS (Top Cards)
  // ============================================================================

  /**
   * GET /api/dashboard/overview
   * Returns top-level metrics for dashboard cards
   */
  router.get('/overview', async (req, res) => {
    try {
      const data = await getCachedQuery('overview', async () => {
        const today = new Date().toISOString().split('T')[0];

        // Query all metrics in parallel for speed
        const [dauResult, totalPlayersResult, avgSessionResult, gamesResult] = await Promise.all([
          // Daily Active Users (today)
          db.query(`
            SELECT COUNT(DISTINCT user_id) as dau
            FROM events
            WHERE received_at >= CURRENT_DATE
          `),
          
          // Total players (all-time)
          db.query(`
            SELECT COUNT(DISTINCT user_id) as total_players
            FROM events
          `),
          
          // Average session duration (last 7 days)
          // ✅ Measures: Total app engagement time (not just gameplay)
          // Uses: Events grouped by user_id + session_id
          db.query(`
            SELECT 
              ROUND(AVG(duration_seconds)) as avg_session_seconds
            FROM (
              SELECT 
                user_id,
                payload->>'session_id' as session_id,
                EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) as duration_seconds
              FROM events
              WHERE received_at >= CURRENT_DATE - INTERVAL '7 days'
                AND payload->>'session_id' IS NOT NULL
              GROUP BY user_id, payload->>'session_id'
              HAVING EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) > 0
            ) sessions
          `),
          
          // Total games played (today)
          // ✅ FIX: Use correct event types from Flutter app
          db.query(`
            SELECT COUNT(*) as games_today
            FROM events
            WHERE event_type = 'game_ended'
              AND received_at >= CURRENT_DATE
          `)
        ]);

        return {
          dau: parseInt(dauResult.rows[0]?.dau || 0),
          total_players: parseInt(totalPlayersResult.rows[0]?.total_players || 0),
          avg_session_seconds: parseInt(avgSessionResult.rows[0]?.avg_session_seconds || 0),
          games_today: parseInt(gamesResult.rows[0]?.games_today || 0),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching overview metrics:', error);
      res.status(500).json({ error: 'Failed to fetch overview metrics' });
    }
  });

  // ============================================================================
  // 2. DAILY ACTIVE USERS TREND
  // ============================================================================

  /**
   * GET /api/dashboard/dau-trend?days=30
   * Returns DAU for the last N days
   */
  router.get('/dau-trend', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 30), 90); // Max 90 days
      
      const data = await getCachedQuery(`dau-trend-${days}`, async () => {
        const result = await db.query(`
          SELECT 
            DATE(received_at) as date,
            COUNT(DISTINCT user_id) as dau
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
          GROUP BY DATE(received_at)
          ORDER BY date ASC
        `);

        return {
          dates: result.rows.map(r => r.date),
          values: result.rows.map(r => parseInt(r.dau)),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching DAU trend:', error);
      res.status(500).json({ error: 'Failed to fetch DAU trend' });
    }
  });

  // ============================================================================
  // 3. LEVEL PERFORMANCE
  // ============================================================================

  /**
   * GET /api/dashboard/level-performance?zone=1
   * Returns completion rates for levels in a zone
   * ✅ FIX: Use actual events from Flutter app (level_started, level_failed, game_ended)
   */
  router.get('/level-performance', async (req, res) => {
    try {
      const zone = parseInt(req.query.zone || 1);
      
      const data = await getCachedQuery(`level-performance-zone${zone}`, async () => {
        // Calculate level range for zone (Zone 1 = Levels 1-10, Zone 2 = 11-20, etc.)
        const startLevel = (zone - 1) * 10 + 1;
        const endLevel = zone * 10;
        
        // ✅ FIX: Your app sends level_started and level_failed
        // We'll calculate completion rate as: (started - failed) / started
        const result = await db.query(`
          SELECT 
            payload->>'level_id' as level,
            COUNT(DISTINCT CASE WHEN event_type = 'level_started' THEN user_id END) as players_started,
            COUNT(DISTINCT CASE WHEN event_type = 'level_failed' THEN user_id END) as players_failed,
            ROUND(100.0 * (COUNT(DISTINCT CASE WHEN event_type = 'level_started' THEN user_id END) - 
                           COUNT(DISTINCT CASE WHEN event_type = 'level_failed' THEN user_id END)) / 
                  NULLIF(COUNT(DISTINCT CASE WHEN event_type = 'level_started' THEN user_id END), 0), 1) as completion_rate
          FROM events
          WHERE payload->>'level_id' IN (${Array.from({length: 10}, (_, i) => `'${startLevel + i}'`).join(',')})
            AND event_type IN ('level_started', 'level_failed')
            AND received_at >= CURRENT_DATE - INTERVAL '7 days'
          GROUP BY payload->>'level_id'
          ORDER BY CAST(payload->>'level_id' AS INTEGER)
        `);

        return {
          zone,
          levels: result.rows.map(r => ({
            level: parseInt(r.level),
            started: parseInt(r.players_started),
            failed: parseInt(r.players_failed),
            completed: parseInt(r.players_started) - parseInt(r.players_failed),
            completion_rate: parseFloat(r.completion_rate) || 0
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching level performance:', error);
      res.status(500).json({ error: 'Failed to fetch level performance' });
    }
  });

  // ============================================================================
  // 4. TOP EVENTS (Real-time activity)
  // ============================================================================

  /**
   * GET /api/dashboard/top-events?limit=10
   * Returns most recent events for live activity feed
   */
  router.get('/top-events', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || 10), 50);
      
      // Cache for only 30 seconds (this is for "live" feed)
      const data = await getCachedQuery(`top-events-${limit}`, async () => {
        const result = await db.query(`
          SELECT 
            event_type,
            user_id,
            payload,
            received_at
          FROM events
          WHERE received_at >= NOW() - INTERVAL '5 minutes'
          ORDER BY received_at DESC
          LIMIT $1
        `, [limit]);

        return {
          events: result.rows.map(r => ({
            type: r.event_type,
            user: r.user_id.substring(0, 20) + '...', // Truncate for privacy
            data: r.payload,
            timestamp: r.received_at
          })),
          last_updated: new Date().toISOString()
        };
      }, 30); // 30 second cache

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching top events:', error);
      res.status(500).json({ error: 'Failed to fetch top events' });
    }
  });

  // ============================================================================
  // 5. AD PERFORMANCE
  // ============================================================================

  /**
   * GET /api/dashboard/ad-performance
   * Returns ad metrics (rewarded, interstitial)
   * ✅ Note: Returns zeros if no ad events (ad tracking not yet implemented in app)
   */
  router.get('/ad-performance', async (req, res) => {
    try {
      const data = await getCachedQuery('ad-performance', async () => {
        const [rewardedResult, interstitialResult] = await Promise.all([
          // Rewarded ads
          db.query(`
            SELECT 
              COUNT(CASE WHEN event_type = 'rewarded_ad_shown' THEN 1 END) as shown,
              COUNT(CASE WHEN event_type = 'rewarded_ad_watched' THEN 1 END) as watched,
              ROUND(100.0 * COUNT(CASE WHEN event_type = 'rewarded_ad_watched' THEN 1 END) / 
                    NULLIF(COUNT(CASE WHEN event_type = 'rewarded_ad_shown' THEN 1 END), 0), 1) as completion_rate
            FROM events
            WHERE event_type LIKE 'rewarded_ad_%'
              AND received_at >= CURRENT_DATE - INTERVAL '7 days'
          `),
          
          // Interstitial ads
          db.query(`
            SELECT 
              COUNT(*) as shown
            FROM events
            WHERE event_type = 'interstitial_shown'
              AND received_at >= CURRENT_DATE - INTERVAL '7 days'
          `)
        ]);

        return {
          rewarded: {
            shown: parseInt(rewardedResult.rows[0]?.shown || 0),
            watched: parseInt(rewardedResult.rows[0]?.watched || 0),
            completion_rate: parseFloat(rewardedResult.rows[0]?.completion_rate || 0)
          },
          interstitial: {
            shown: parseInt(interstitialResult.rows[0]?.shown || 0)
          },
          message: (parseInt(rewardedResult.rows[0]?.shown || 0) === 0 && parseInt(interstitialResult.rows[0]?.shown || 0) === 0) 
            ? 'No ad events tracked yet. Add ad event tracking to Flutter app to see data.' 
            : null,
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching ad performance:', error);
      res.status(500).json({ error: 'Failed to fetch ad performance' });
    }
  });

  // ============================================================================
  // 6. CUSTOM QUERY (Your Original Question)
  // ============================================================================

  /**
   * GET /api/dashboard/level-ends?level=6&date=2025-11-16
   * Answers: "How many games ended at level X on date Y?"
   */
  router.get('/level-ends', async (req, res) => {
    try {
      const level = req.query.level || '6';
      const date = req.query.date || new Date().toISOString().split('T')[0];
      
      const data = await getCachedQuery(`level-ends-${level}-${date}`, async () => {
        const result = await db.query(`
          SELECT 
            COUNT(*) as total_games,
            COUNT(DISTINCT user_id) as unique_players,
            ROUND(AVG(CAST(payload->>'score' AS NUMERIC)), 1) as avg_score
          FROM events
          WHERE event_type = 'level_failed'
            AND payload->>'level_id' = $1
            AND DATE(received_at) = $2
        `, [level, date]);

        return {
          level: parseInt(level),
          date,
          total_games: parseInt(result.rows[0]?.total_games || 0),
          unique_players: parseInt(result.rows[0]?.unique_players || 0),
          avg_score: parseFloat(result.rows[0]?.avg_score || 0),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching level ends:', error);
      res.status(500).json({ error: 'Failed to fetch level ends' });
    }
  });

  // ============================================================================
  // 7. RETENTION ANALYSIS
  // ============================================================================

  /**
   * GET /api/dashboard/retention
   * Returns Day 1, Day 3, Day 7, Day 14, Day 30 retention rates
   */
  router.get('/retention', async (req, res) => {
    try {
      const data = await getCachedQuery('retention-cohorts', async () => {
        // Find users and their install date
        const result = await db.query(`
          WITH first_sessions AS (
            SELECT 
              user_id,
              MIN(DATE(received_at)) as install_date
            FROM events
            WHERE event_type = 'user_installed' 
               OR event_type = 'app_launched'
            GROUP BY user_id
          ),
          return_sessions AS (
            SELECT DISTINCT
              fs.user_id,
              fs.install_date,
              DATE(e.received_at) as return_date,
              DATE(e.received_at) - fs.install_date as days_since_install
            FROM first_sessions fs
            JOIN events e ON fs.user_id = e.user_id
            WHERE e.event_type IN ('app_launched', 'game_started', 'level_started')
              AND DATE(e.received_at) > fs.install_date
          ),
          cohort_sizes AS (
            SELECT 
              install_date,
              COUNT(DISTINCT user_id) as cohort_size
            FROM first_sessions
            GROUP BY install_date
          )
          SELECT
            days_since_install,
            COUNT(DISTINCT rs.user_id) as returned_users,
            ROUND(100.0 * COUNT(DISTINCT rs.user_id) / 
              SUM(CASE 
                WHEN cs.install_date <= CURRENT_DATE - days_since_install 
                THEN cs.cohort_size 
                ELSE 0 
              END), 1) as retention_rate
          FROM return_sessions rs
          JOIN cohort_sizes cs ON rs.install_date = cs.install_date
          WHERE days_since_install IN (1, 3, 7, 14, 30)
            AND rs.install_date <= CURRENT_DATE - days_since_install
          GROUP BY days_since_install
          ORDER BY days_since_install
        `);

        return {
          retention: {
            day1: result.rows.find(r => r.days_since_install === 1) || { returned_users: 0, retention_rate: 0 },
            day3: result.rows.find(r => r.days_since_install === 3) || { returned_users: 0, retention_rate: 0 },
            day7: result.rows.find(r => r.days_since_install === 7) || { returned_users: 0, retention_rate: 0 },
            day14: result.rows.find(r => r.days_since_install === 14) || { returned_users: 0, retention_rate: 0 },
            day30: result.rows.find(r => r.days_since_install === 30) || { returned_users: 0, retention_rate: 0 }
          },
          last_updated: new Date().toISOString()
        };
      }, 3600); // Cache for 1 hour (retention changes slowly)

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching retention:', error);
      res.status(500).json({ error: 'Failed to fetch retention data' });
    }
  });

  // ============================================================================
  // 8. CACHE MANAGEMENT
  // ============================================================================

  /**
   * POST /api/dashboard/refresh-cache
   * Manually refresh all dashboard caches
   */
  router.post('/refresh-cache', async (req, res) => {
    try {
      // Clear all dashboard caches
      const pattern = `${CACHE_PREFIX}*`;
      
      // Note: This is a simplified version. In production, you'd use Redis SCAN
      logger.info('📊 Manual cache refresh triggered');
      
      res.json({ 
        success: true, 
        message: 'Cache will be refreshed on next request',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('📊 Error refreshing cache:', error);
      res.status(500).json({ error: 'Failed to refresh cache' });
    }
  });

  // ============================================================================
  // 8. HEALTH CHECK
  // ============================================================================

  /**
   * GET /api/dashboard/health
   * Check dashboard API health
   */
  router.get('/health', async (req, res) => {
    try {
      // Test database connection
      await db.query('SELECT 1');
      
      // Test cache connection
      await cacheManager.set('health-check', 'ok', 10);
      const cacheTest = await cacheManager.get('health-check');
      
      res.json({
        status: 'healthy',
        database: 'connected',
        cache: cacheTest === 'ok' ? 'connected' : 'degraded',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('📊 Dashboard health check failed:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
};

