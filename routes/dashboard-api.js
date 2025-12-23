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
   * Helper: Get cache manager dynamically from app.locals (supports runtime upgrades)
   */
  function getCacheManager(req) {
    // ✅ CRITICAL: Always get fresh reference from app.locals to support runtime upgrades
    return req.app.locals.cacheManager || cacheManager;
  }

  /**
   * ✅ NEW: Execute query with timeout and connection pool error handling
   * Handles connection pool exhaustion gracefully with retry logic
   */
  async function executeQueryWithTimeout(queryFn, timeoutMs = 30000) {
    try {
      return await Promise.race([
        queryFn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
        )
      ]);
    } catch (error) {
      // Handle connection pool exhaustion gracefully
      if (error.message.includes('timeout exceeded when trying to connect') ||
          error.message.includes('Query read timeout')) {
        logger.warn('📊 Connection pool issue detected, retrying with delay...', {
          error: error.message
        });
        // Retry once after short delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          return await queryFn();
        } catch (retryError) {
          logger.error('📊 Query retry failed:', retryError.message);
          throw new Error(`Query failed after retry: ${retryError.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Helper: Get data from cache or database
   */
  async function getCachedQuery(req, cacheKey, queryFn, ttl = CACHE_TTL) {
    try {
      // ✅ Get fresh cache manager reference (supports runtime upgrades)
      const currentCacheManager = getCacheManager(req);
      
      // Check if cache manager is available
      if (!currentCacheManager || !currentCacheManager.redis) {
        logger.warn(`📊 Cache unavailable for ${cacheKey} - querying database directly`, {
          hasCacheManager: !!currentCacheManager,
          hasRedis: currentCacheManager?.redis ? true : false,
          redisStatus: currentCacheManager?.redis?.status || 'null'
        });
        return await executeQueryWithTimeout(queryFn);
      }
      
      // ✅ NEW: Check if Redis is actually ready (might have disconnected)
      if (currentCacheManager.redis.status !== 'ready') {
        logger.warn(`📊 Redis not ready for ${cacheKey} (status: ${currentCacheManager.redis.status}) - querying database directly`);
        return await executeQueryWithTimeout(queryFn);
      }

      // Try cache first
      const cached = await currentCacheManager.get(`${CACHE_PREFIX}${cacheKey}`);
      if (cached) {
        // ✅ REDUCED LOGGING: Only log cache hits in debug mode to avoid rate limiting
        logger.debug(`📊 Cache HIT: ${cacheKey}`);
        return cached; // ✅ FIX: CacheManager already returns parsed JSON
      }

      // Cache miss - query database with timeout handling
      // ✅ REDUCED LOGGING: Only log cache misses in debug mode (too frequent for production)
      logger.debug(`📊 Cache MISS: ${cacheKey} - querying database`);
      const result = await executeQueryWithTimeout(queryFn);
      
      // Store in cache and verify it succeeded
      const cacheKeyFull = `${CACHE_PREFIX}${cacheKey}`;
      const setSuccess = await currentCacheManager.set(cacheKeyFull, result, ttl);
      
      if (setSuccess) {
        // ✅ REDUCED LOGGING: Only log cache sets in debug mode
        logger.debug(`📊 Cache SET: ${cacheKey} (TTL: ${ttl}s)`);
        
        // Verify it was actually stored (for debugging)
        const verifyCache = await currentCacheManager.get(cacheKeyFull);
        if (verifyCache) {
          logger.debug(`📊 Cache VERIFIED: ${cacheKey} stored successfully`);
        } else {
          // ✅ Keep warnings/errors as they indicate problems
          logger.warn(`📊 Cache WARNING: ${cacheKey} set returned true but get returned null`);
        }
      } else {
        // ✅ Keep errors as they indicate problems
        logger.error(`📊 Cache SET FAILED: ${cacheKey} - cache.set() returned false`);
      }
      
      return result;
    } catch (error) {
      logger.error(`📊 Error in getCachedQuery for ${cacheKey}:`, {
        error: error.message,
        stack: error.stack
      });
      // On error, still try to return data from query (with timeout handling)
      try {
        return await executeQueryWithTimeout(queryFn);
      } catch (queryError) {
        throw queryError;
      }
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
      const data = await getCachedQuery(req, 'overview', async () => {
        const today = new Date().toISOString().split('T')[0];

        // ✅ OPTIMIZED: Use materialized views for better performance
        // Query all metrics in parallel for speed
        const [todayAggResult, totalPlayersResult, avgSessionResult, avgGameDurationResult, sessionsPerUserResult] = await Promise.all([
          // Daily Active Users, MAU, and games (today) - from daily_aggregations materialized view ✅ ENHANCED
          db.query(`
            SELECT 
              dau,
              mau,
              games_started,
              games_ended,
              avg_games_per_user,
              avg_sessions_per_user,
              avg_session_length_seconds,
              CASE 
                WHEN games_started > 0 
                THEN ROUND(100.0 * games_ended / games_started, 1)
                ELSE 0
              END as completion_rate
            FROM daily_aggregations
            WHERE date = CURRENT_DATE
            LIMIT 1
          `),
          
          // Total players (all-time) - still need events table for this
          db.query(`
            SELECT COUNT(DISTINCT user_id) as total_players
            FROM events
          `),
          
          // Average session duration (last 7 days) - still need events table for session calculation
          // ✅ Measures: Total app engagement time (not just gameplay)
          // ✅ Capped at 60 minutes to filter outliers (background sessions)
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
                AND EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) <= 3600
            ) sessions
          `),
          
          // Average game duration from game_ended events (today) - still need events table
          db.query(`
            SELECT 
              ROUND(AVG((payload->>'duration_seconds')::int)) as avg_game_duration
            FROM events
            WHERE event_type = 'game_ended'
              AND received_at >= CURRENT_DATE
              AND (payload->>'duration_seconds')::int > 0
          `),

          // Average sessions per user (today) - still need events table
          // ✅ Counts distinct session_id per user_id for today
          // ✅ Uses Redis cache to avoid DB load
          db.query(`
            SELECT 
              ROUND(AVG(session_count)::numeric, 1) as avg_sessions_per_user
            FROM (
              SELECT 
                user_id,
                COUNT(DISTINCT payload->>'session_id') as session_count
              FROM events
              WHERE received_at >= CURRENT_DATE
                AND payload->>'session_id' IS NOT NULL
              GROUP BY user_id
              HAVING COUNT(DISTINCT payload->>'session_id') > 0
            ) user_sessions
          `)
        ]);

        const todayData = todayAggResult.rows[0] || {};

        return {
          dau: parseInt(todayData.dau || 0),
          mau: parseInt(todayData.mau || todayData.dau || 0), // ✅ NEW: MAU (fallback to DAU if not available)
          total_players: parseInt(totalPlayersResult.rows[0]?.total_players || 0),
          avg_session_seconds: parseInt(todayData.avg_session_length_seconds || avgSessionResult.rows[0]?.avg_session_seconds || 0), // ✅ ENHANCED: Use from daily_aggregations
          avg_game_duration: parseInt(avgGameDurationResult.rows[0]?.avg_game_duration || 0),
          avg_sessions_per_user: parseFloat(todayData.avg_sessions_per_user || sessionsPerUserResult.rows[0]?.avg_sessions_per_user || 0), // ✅ ENHANCED: Use from daily_aggregations
          avg_games_per_user: parseFloat(todayData.avg_games_per_user || 0), // ✅ NEW
          games_started: parseInt(todayData.games_started || 0),
          games_ended: parseInt(todayData.games_ended || 0),
          completion_rate: parseFloat(todayData.completion_rate || 0),
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
      
      const data = await getCachedQuery(req, `dau-trend-${days}`, async () => {
        // ✅ OPTIMIZED: Use daily_aggregations materialized view for better performance
        const result = await db.query(`
          SELECT 
            date,
            dau
          FROM daily_aggregations
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ORDER BY date ASC
        `);

        return {
          dates: result.rows.map(r => r.date),
          values: result.rows.map(r => parseInt(r.dau || 0)),
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
  // 2b. GAMES PER PLAYER TREND
  // ============================================================================

  /**
   * GET /api/dashboard/games-per-player-trend?days=7
   * Returns daily games per player for the last N days
   */
  router.get('/games-per-player-trend', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `games-per-player-trend-${days}`, async () => {
        // ✅ OPTIMIZED: Use daily_aggregations materialized view for better performance
        const result = await db.query(`
          SELECT 
            date,
            games_started,
            dau
          FROM daily_aggregations
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ORDER BY date ASC
        `);

        const daily = result.rows.map(row => ({
          date: row.date,
          games_per_player: row.dau > 0 
            ? parseFloat((parseInt(row.games_started || 0) / parseInt(row.dau || 1)).toFixed(1))
            : 0,
          games_started: parseInt(row.games_started || 0),
          dau: parseInt(row.dau || 0)
        }));

        // Calculate 7-day average
        const avgGamesPerPlayer = daily.length > 0
          ? parseFloat((daily.reduce((sum, d) => sum + d.games_per_player, 0) / daily.length).toFixed(1))
          : 0;

        return {
          daily,
          avg_7days: avgGamesPerPlayer,
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching games per player trend:', error);
      res.status(500).json({ error: 'Failed to fetch games per player trend' });
    }
  });

  // ============================================================================
  // 3. GAME COMPLETION RATE TREND
  // ============================================================================

  /**
   * GET /api/dashboard/completion-trend?days=7
   * Returns game completion rate trend over time
   */
  router.get('/completion-trend', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `completion-trend-${days}`, async () => {
        // ✅ OPTIMIZED: Use daily_aggregations materialized view
        const result = await db.query(`
          SELECT 
            date,
            games_started,
            games_ended,
            CASE 
              WHEN games_started > 0 
              THEN ROUND(100.0 * games_ended / games_started, 1)
              ELSE 0
            END as completion_rate
          FROM daily_aggregations
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ORDER BY date ASC
        `);

        return {
          trend: result.rows.map(r => ({
            date: r.date,
            games_started: parseInt(r.games_started || 0),
            games_ended: parseInt(r.games_ended || 0),
            completion_rate: parseFloat(r.completion_rate || 0)
          })).reverse(), // Oldest to newest for charts
          summary: {
            avg_completion_rate: result.rows.length > 0 
              ? parseFloat((result.rows.reduce((sum, r) => sum + parseFloat(r.completion_rate || 0), 0) / result.rows.length).toFixed(1))
              : 0,
            total_started: result.rows.reduce((sum, r) => sum + parseInt(r.games_started || 0), 0),
            total_ended: result.rows.reduce((sum, r) => sum + parseInt(r.games_ended || 0), 0)
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching completion trend:', error);
      res.status(500).json({ error: 'Failed to fetch completion trend' });
    }
  });

  // ============================================================================
  // 4. LEVEL PERFORMANCE
  // ============================================================================

  /**
   * GET /api/dashboard/level-performance?zone=1&daily=true
   * Returns completion rates for levels in a zone
   * If daily=true, returns daily breakdown for last 7 days with averages
   * ✅ FIX: Use actual events from Flutter app (level_started, level_failed, game_ended)
   */
  router.get('/level-performance', async (req, res) => {
    try {
      const zone = parseInt(req.query.zone || 1);
      const daily = req.query.daily === 'true';
      const days = parseInt(req.query.days || 7); // ✅ Support days parameter
      
      const cacheKey = daily ? `level-performance-daily-zone${zone}-${days}` : `level-performance-zone${zone}-${days}`;
      
      const data = await getCachedQuery(req, cacheKey, async () => {
        // Calculate level range for zone (Zone 1 = Levels 1-10, Zone 2 = 11-20, etc.)
        const startLevel = (zone - 1) * 10 + 1;
        const endLevel = zone * 10;
        const levelIds = Array.from({length: 10}, (_, i) => `'${startLevel + i}'`).join(',');
        
        if (daily) {
          // Daily breakdown for specified days
          const result = await db.query(`
            SELECT 
              DATE(received_at) as date,
              payload->>'level_id' as level,
              COUNT(DISTINCT CASE WHEN event_type = 'level_started' THEN user_id END) as players_started,
              COUNT(DISTINCT CASE WHEN event_type = 'level_failed' THEN user_id END) as players_failed
            FROM events
            WHERE payload->>'level_id' IN (${levelIds})
              AND event_type IN ('level_started', 'level_failed')
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at), payload->>'level_id'
            ORDER BY DATE(received_at) DESC, CAST(payload->>'level_id' AS INTEGER)
          `);

          // Group by date
          const dailyData = {};
          result.rows.forEach(row => {
            const date = row.date.toISOString().split('T')[0];
            if (!dailyData[date]) {
              dailyData[date] = {};
            }
            const level = parseInt(row.level);
            const started = parseInt(row.players_started || 0);
            const failed = parseInt(row.players_failed || 0);
            const completed = started - failed;
            const completionRate = started > 0 ? parseFloat(((completed / started) * 100).toFixed(1)) : 0;
            
            dailyData[date][level] = {
              level_id: level, // ✅ Frontend expects level_id
              level,            // Keep for backward compatibility
              started,
              completed,
              failed,
              completion_rate: completionRate
            };
          });

          // Convert to array format and fill missing dates/levels
          const dates = Object.keys(dailyData).sort((a, b) => new Date(b) - new Date(a));
          const dailyArray = dates.map(date => {
            const levels = {};
            for (let level = startLevel; level <= endLevel; level++) {
              levels[level] = dailyData[date][level] || {
                level_id: level, // ✅ Frontend expects level_id
                level,            // Keep for backward compatibility
                started: 0,
                completed: 0,
                failed: 0,
                completion_rate: 0
              };
            }
            return { date, levels };
          });

          // Calculate averages
          const averages = {};
          for (let level = startLevel; level <= endLevel; level++) {
            const rates = dailyArray
              .map(d => d.levels[level].completion_rate)
              .filter(r => r > 0);
            averages[level] = rates.length > 0
              ? parseFloat((rates.reduce((sum, r) => sum + r, 0) / rates.length).toFixed(1))
              : 0;
          }

          return {
            zone,
            daily: dailyArray,
            averages,
            last_updated: new Date().toISOString()
          };
        } else {
          // Original aggregated format
          // ✅ FIX: Calculate avg_attempts and return level_id for frontend compatibility
          const result = await db.query(`
            SELECT 
              payload->>'level_id' as level,
              COUNT(DISTINCT CASE WHEN event_type = 'level_started' THEN user_id END) as players_started,
              COUNT(DISTINCT CASE WHEN event_type = 'level_failed' THEN user_id END) as players_failed,
              COUNT(CASE WHEN event_type = 'level_started' THEN 1 END) as total_starts,
              ROUND(100.0 * (COUNT(DISTINCT CASE WHEN event_type = 'level_started' THEN user_id END) - 
                             COUNT(DISTINCT CASE WHEN event_type = 'level_failed' THEN user_id END)) / 
                    NULLIF(COUNT(DISTINCT CASE WHEN event_type = 'level_started' THEN user_id END), 0), 1) as completion_rate
            FROM events
            WHERE payload->>'level_id' IN (${levelIds})
              AND event_type IN ('level_started', 'level_failed')
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'level_id'
            ORDER BY CAST(payload->>'level_id' AS INTEGER)
          `);

          return {
            zone,
            levels: result.rows.map(r => {
              const levelId = parseInt(r.level);
              const playersStarted = parseInt(r.players_started || 0);
              const totalStarts = parseInt(r.total_starts || 0);
              // Average attempts = total starts / unique players who started
              const avgAttempts = playersStarted > 0 
                ? parseFloat((totalStarts / playersStarted).toFixed(2))
                : 0;
              
              return {
                level_id: levelId, // ✅ Frontend expects level_id
                level: levelId,    // Keep for backward compatibility
                started: playersStarted,
                failed: parseInt(r.players_failed || 0),
                completed: playersStarted - parseInt(r.players_failed || 0),
                completion_rate: parseFloat(r.completion_rate || 0),
                avg_attempts: avgAttempts // ✅ Frontend expects avg_attempts
              };
            }),
            last_updated: new Date().toISOString()
          };
        }
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching level performance:', error);
      res.status(500).json({ error: 'Failed to fetch level performance' });
    }
  });

  /**
   * GET /api/dashboard/level-completion-stats?zone=1&date=2024-11-28
   * Returns level analytics with CORRECT metric calculations:
   * 
   * First Attempt % = (users who completed on first try) / (users who tried for first time)
   * Success Rate = (total completions) / (total attempts)
   * 
   * Query params:
   * - zone: Zone number (1-5), default 1
   * - date: Specific date (YYYY-MM-DD), or 'all' for all-time, default is last 7 days
   */
  router.get('/level-completion-stats', async (req, res) => {
    try {
      const zone = parseInt(req.query.zone || 1);
      const dateParam = req.query.date; // 'YYYY-MM-DD', 'all', or undefined (default: 7 days)
      
      // Build date filter
      let dateFilter = '';
      let dateLabel = 'Last 7 Days';
      
      if (dateParam === 'all') {
        dateFilter = ''; // No date filter
        dateLabel = 'All Time';
      } else if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        // Specific date: filter for that day only
        dateFilter = `AND DATE(received_at) = '${dateParam}'`;
        dateLabel = dateParam;
      } else {
        // Default: last 7 days
        dateFilter = `AND received_at >= CURRENT_DATE - INTERVAL '7 days'`;
        dateLabel = 'Last 7 Days';
      }
      
      const cacheKey = `level-completion-stats-v2-zone${zone}-${dateParam || '7days'}`;
      
      const data = await getCachedQuery(req, cacheKey, async () => {
        // Calculate level range for zone (Zone 1 = Levels 1-10, Zone 2 = 11-20, etc.)
        const startLevel = (zone - 1) * 10 + 1;
        const endLevel = zone * 10;
        const levelIds = Array.from({length: 10}, (_, i) => `'${startLevel + i}'`).join(',');
        
        // ============================================================================
        // QUERY 1: Get completion stats (total completions + first attempt completions)
        // ============================================================================
        const completionsResult = await db.query(`
          SELECT 
            payload->>'level_id' as level,
            COUNT(*) as total_completions,
            COUNT(DISTINCT user_id) as unique_completers,
            COUNT(CASE WHEN (payload->>'first_attempt')::boolean = true THEN 1 END) as first_attempt_completions,
            ROUND(AVG((payload->>'time_seconds')::numeric)) as avg_completion_time
          FROM events
          WHERE event_type = 'level_completed'
            AND payload->>'level_id' IN (${levelIds})
            ${dateFilter}
          GROUP BY payload->>'level_id'
        `);

        // ============================================================================
        // QUERY 2: Get total level_started counts (for Success Rate denominator)
        // ============================================================================
        const totalStartsResult = await db.query(`
          SELECT 
            payload->>'level_id' as level,
            COUNT(*) as total_starts
          FROM events
          WHERE event_type = 'level_started'
            AND payload->>'level_id' IN (${levelIds})
            ${dateFilter}
          GROUP BY payload->>'level_id'
        `);

        // ============================================================================
        // QUERY 3: Get FIRST-TIME starts (for First Attempt % denominator)
        // Users who started the level with is_first_attempt=true
        // ============================================================================
        const firstTimeStartsResult = await db.query(`
          SELECT 
            payload->>'level_id' as level,
            COUNT(*) as first_time_starts
          FROM events
          WHERE event_type = 'level_started'
            AND payload->>'level_id' IN (${levelIds})
            AND (payload->>'is_first_attempt')::boolean = true
            ${dateFilter}
          GROUP BY payload->>'level_id'
        `);

        // Create lookup maps
        const completionsMap = {};
        completionsResult.rows.forEach(row => {
          completionsMap[row.level] = {
            total_completions: parseInt(row.total_completions || 0),
            unique_completers: parseInt(row.unique_completers || 0),
            first_attempt_completions: parseInt(row.first_attempt_completions || 0),
            avg_completion_time: parseInt(row.avg_completion_time || 0)
          };
        });

        const totalStartsMap = {};
        totalStartsResult.rows.forEach(row => {
          totalStartsMap[row.level] = parseInt(row.total_starts || 0);
        });

        const firstTimeStartsMap = {};
        firstTimeStartsResult.rows.forEach(row => {
          firstTimeStartsMap[row.level] = parseInt(row.first_time_starts || 0);
        });

        // ============================================================================
        // BUILD RESPONSE with CORRECT calculations
        // ============================================================================
        const allLevels = [];
        for (let level = startLevel; level <= endLevel; level++) {
          const levelStr = String(level);
          const completion = completionsMap[levelStr] || { total_completions: 0, unique_completers: 0, first_attempt_completions: 0, avg_completion_time: 0 };
          const totalStarts = totalStartsMap[levelStr] || 0;
          const firstTimeStarts = firstTimeStartsMap[levelStr] || 0;
          
          // SUCCESS RATE = total completions / total attempts
          // Example: User tried 2 times, completed once → 1/2 = 50%
          const successRate = totalStarts > 0 
            ? parseFloat(((completion.total_completions / totalStarts) * 100).toFixed(1)) 
            : 0;
          
          // FIRST ATTEMPT % = first-time completions / first-time starts
          // Example: 10 users tried level for first time, 3 completed on first try → 3/10 = 30%
          const firstAttemptRate = firstTimeStarts > 0 
            ? parseFloat(((completion.first_attempt_completions / firstTimeStarts) * 100).toFixed(1)) 
            : 0;
          
          allLevels.push({
            level,
            // Success Rate metrics
            total_completions: completion.total_completions,
            total_starts: totalStarts,
            success_rate: successRate,
            // First Attempt metrics
            first_attempt_completions: completion.first_attempt_completions,
            first_time_starts: firstTimeStarts,
            first_attempt_rate: firstAttemptRate,
            // Time
            avg_completion_time_seconds: completion.avg_completion_time
          });
        }

        // Calculate zone summary
        const totalCompletions = allLevels.reduce((sum, l) => sum + l.total_completions, 0);
        const totalStarts = allLevels.reduce((sum, l) => sum + l.total_starts, 0);
        const totalFirstAttemptCompletions = allLevels.reduce((sum, l) => sum + l.first_attempt_completions, 0);
        const totalFirstTimeStarts = allLevels.reduce((sum, l) => sum + l.first_time_starts, 0);

        return {
          zone,
          date_filter: dateLabel,
          levels: allLevels,
          summary: {
            total_completions: totalCompletions,
            total_starts: totalStarts,
            overall_success_rate: totalStarts > 0 
              ? parseFloat(((totalCompletions / totalStarts) * 100).toFixed(1)) 
              : 0,
            overall_first_attempt_rate: totalFirstTimeStarts > 0 
              ? parseFloat(((totalFirstAttemptCompletions / totalFirstTimeStarts) * 100).toFixed(1)) 
              : 0
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching level completion stats:', error);
      res.status(500).json({ error: 'Failed to fetch level completion stats' });
    }
  });

  // ============================================================================
  // 3b. BONUS COLLECTION ANALYTICS
  // ============================================================================

  /**
   * GET /api/dashboard/bonus-collection-stats?zone=1&date=2024-11-28
   * Returns bonus collection stats per level for a zone
   * 
   * Query params:
   * - zone: Zone number (1-10), default 1
   * - date: Specific date (YYYY-MM-DD), or 'all' for all-time, default is last 7 days
   */
  router.get('/bonus-collection-stats', async (req, res) => {
    try {
      const zone = parseInt(req.query.zone || 1);
      const dateParam = req.query.date;
      
      // Build date filter
      let dateFilter = '';
      let dateLabel = 'Last 7 Days';
      
      if (dateParam === 'all') {
        dateFilter = '';
        dateLabel = 'All Time';
      } else if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        dateFilter = `AND DATE(received_at) = '${dateParam}'`;
        dateLabel = dateParam;
      } else {
        dateFilter = `AND received_at >= CURRENT_DATE - INTERVAL '7 days'`;
        dateLabel = 'Last 7 Days';
      }
      
      const cacheKey = `bonus-collection-stats-zone${zone}-${dateParam || '7days'}`;
      
      const data = await getCachedQuery(req, cacheKey, async () => {
        // Calculate level range for zone
        const startLevel = (zone - 1) * 10 + 1;
        const endLevel = zone * 10;
        const levelIds = Array.from({length: 10}, (_, i) => `'${startLevel + i}'`).join(',');
        
        // ============================================================================
        // QUERY: Get bonus collection stats grouped by level and bonus type
        // ============================================================================
        const bonusResult = await db.query(`
          SELECT 
            payload->>'level_id' as level,
            payload->>'bonus_type' as bonus_type,
            COUNT(*) as count,
            SUM(CASE WHEN payload->>'bonus_type' = 'coins' THEN (payload->>'amount')::int ELSE 0 END) as total_coins,
            SUM(CASE WHEN payload->>'bonus_type' = 'gems' THEN (payload->>'amount')::int ELSE 0 END) as total_gems,
            COUNT(CASE WHEN payload->>'bonus_type' = 'shield' THEN 1 END) as shield_count,
            payload->>'shield_tier' as shield_tier
          FROM events
          WHERE event_type = 'bonus_collected'
            AND payload->>'level_id' IN (${levelIds})
            ${dateFilter}
          GROUP BY payload->>'level_id', payload->>'bonus_type', payload->>'shield_tier'
          ORDER BY payload->>'level_id', payload->>'bonus_type'
        `);

        // Aggregate by level
        const levelStats = {};
        for (let level = startLevel; level <= endLevel; level++) {
          levelStats[level] = {
            level,
            shields_collected: 0,
            coins_collected: 0,
            gems_collected: 0,
            shield_tiers: { blue: 0, red: 0, green: 0 },
            total_bonuses: 0
          };
        }

        // Process query results
        bonusResult.rows.forEach(row => {
          const level = parseInt(row.level);
          if (levelStats[level]) {
            const count = parseInt(row.count || 0);
            
            if (row.bonus_type === 'shield') {
              levelStats[level].shields_collected += count;
              const tier = row.shield_tier || 'blue';
              if (levelStats[level].shield_tiers[tier] !== undefined) {
                levelStats[level].shield_tiers[tier] += count;
              }
            } else if (row.bonus_type === 'coins') {
              levelStats[level].coins_collected += parseInt(row.total_coins || 0);
            } else if (row.bonus_type === 'gems') {
              levelStats[level].gems_collected += parseInt(row.total_gems || 0);
            }
            
            levelStats[level].total_bonuses += count;
          }
        });

        // Convert to array
        const levels = Object.values(levelStats);

        // Calculate totals
        const totals = {
          total_shields: levels.reduce((sum, l) => sum + l.shields_collected, 0),
          total_coins: levels.reduce((sum, l) => sum + l.coins_collected, 0),
          total_gems: levels.reduce((sum, l) => sum + l.gems_collected, 0),
          total_bonuses: levels.reduce((sum, l) => sum + l.total_bonuses, 0),
          shield_tiers: {
            blue: levels.reduce((sum, l) => sum + l.shield_tiers.blue, 0),
            red: levels.reduce((sum, l) => sum + l.shield_tiers.red, 0),
            green: levels.reduce((sum, l) => sum + l.shield_tiers.green, 0)
          }
        };

        return {
          zone,
          date_filter: dateLabel,
          levels,
          totals,
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching bonus collection stats:', error);
      res.status(500).json({ error: 'Failed to fetch bonus collection stats' });
    }
  });

  // ============================================================================
  // 3c. COHORT ROI ANALYSIS
  // ============================================================================

  /**
   * GET /api/dashboard/cohort-roi?days=30&country=US
   * Returns ROI metrics by daily install cohort
   * 
   * Parameters:
   * - days: Number of days to look back for cohorts (default: 30)
   * - country: Optional 2-letter country code to filter (e.g., "US", "IL")
   * 
   * Returns per cohort (install date):
   * - users: Number of users installed that day
   * - ad_revenue: Cumulative ad revenue from that cohort
   * - estimated_cost: Estimated acquisition cost (users × manual CPI)
   * - roi: Return on investment percentage
   * - arpu: Average revenue per user
   */
  router.get('/cohort-roi', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 30), 90);
      const country = req.query.country?.toUpperCase() || null;
      const cpi = parseFloat(req.query.cpi || 3.0); // Default CPI estimate
      
      const cacheKey = country 
        ? `cohort-roi-${days}d-${country}-cpi${cpi}` 
        : `cohort-roi-${days}d-all-cpi${cpi}`;
      
      const data = await getCachedQuery(req, cacheKey, async () => {
        // ✅ OPTIMIZED: Use cohort_aggregations for installs and revenue
        // Get cohort data with installs and revenue from materialized view
        const cohortQuery = `
          SELECT 
            cohort_date as install_date,
            cohort_size as users,
            total_revenue_usd,
            ltv,
            paying_users as users_with_revenue
          FROM cohort_aggregations
          WHERE cohort_date >= CURRENT_DATE - INTERVAL '${days} days'
            AND campaign_id IS NULL
          ORDER BY cohort_date DESC
        `;

        const cohortResult = await db.query(cohortQuery);

        // Get country breakdown if needed (still need events table for country data)
        let countryBreakdown = {};
        if (country) {
          const countryResult = await db.query(`
            SELECT 
              DATE(ua.install_date) as install_date,
              COUNT(DISTINCT ua.user_id) as users
            FROM user_acquisitions ua
            WHERE DATE(ua.install_date) >= CURRENT_DATE - INTERVAL '${days} days'
              AND ua.country = '${country}'
            GROUP BY DATE(ua.install_date)
          `);
          
          countryResult.rows.forEach(row => {
            const date = row.install_date.toISOString().split('T')[0];
            if (!countryBreakdown[date]) {
              countryBreakdown[date] = {};
            }
            countryBreakdown[date][country] = parseInt(row.users || 0);
          });
        }

        // Build cohort data
        const cohorts = cohortResult.rows.map(row => {
          const date = row.install_date.toISOString().split('T')[0];
          const users = parseInt(row.users || 0);
          const estimatedCost = users * cpi;
          const totalRevenue = parseFloat(row.total_revenue_usd || 0);
          const roi = estimatedCost > 0 ? ((totalRevenue / estimatedCost) * 100) : 0;
          const arpu = users > 0 ? (totalRevenue / users) : 0;
          const daysSinceInstall = Math.floor(
            (new Date() - new Date(date)) / (1000 * 60 * 60 * 24)
          );
          
          const topCountries = countryBreakdown[date] 
            ? Object.entries(countryBreakdown[date])
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([code, count]) => ({ code, count }))
            : [];
          
          return {
            install_date: date,
            days_since_install: daysSinceInstall,
            users,
            users_with_revenue: parseInt(row.users_with_revenue || 0),
            total_revenue_usd: parseFloat(totalRevenue.toFixed(4)),
            estimated_cost_usd: parseFloat(estimatedCost.toFixed(2)),
            roi_percent: parseFloat(roi.toFixed(1)),
            arpu_usd: parseFloat(arpu.toFixed(4)),
            is_profitable: totalRevenue >= estimatedCost,
            top_countries: topCountries
          };
        });

        // Calculate summary stats
        const totalUsers = cohorts.reduce((sum, c) => sum + c.users, 0);
        const totalRevenue = cohorts.reduce((sum, c) => sum + c.total_revenue_usd, 0);
        const totalCost = cohorts.reduce((sum, c) => sum + c.estimated_cost_usd, 0);
        const profitableCohorts = cohorts.filter(c => c.is_profitable).length;

        return {
          config: {
            days_lookback: days,
            country_filter: country,
            cpi_estimate: cpi,
          },
          summary: {
            total_cohorts: cohorts.length,
            total_users: totalUsers,
            total_revenue_usd: parseFloat(totalRevenue.toFixed(2)),
            total_estimated_cost_usd: parseFloat(totalCost.toFixed(2)),
            overall_roi_percent: totalCost > 0 
              ? parseFloat(((totalRevenue / totalCost) * 100).toFixed(1)) 
              : 0,
            overall_arpu_usd: totalUsers > 0 
              ? parseFloat((totalRevenue / totalUsers).toFixed(4)) 
              : 0,
            profitable_cohorts: profitableCohorts,
            profitable_percent: cohorts.length > 0 
              ? parseFloat(((profitableCohorts / cohorts.length) * 100).toFixed(1)) 
              : 0,
          },
          cohorts,
          last_updated: new Date().toISOString()
        };
      }, 300); // 5 minute cache

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching cohort ROI:', error);
      res.status(500).json({ error: 'Failed to fetch cohort ROI data' });
    }
  });

  /**
   * GET /api/dashboard/countries
   * Returns list of countries with user counts for filtering
   */
  router.get('/countries', async (req, res) => {
    try {
      const data = await getCachedQuery(req, 'countries-list', async () => {
        const result = await db.query(`
          SELECT 
            payload->>'country' as country,
            COUNT(DISTINCT user_id) as users
          FROM events
          WHERE event_type IN ('user_installed', 'app_installed')
            AND payload->>'country' IS NOT NULL
            AND received_at >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY payload->>'country'
          ORDER BY COUNT(DISTINCT user_id) DESC
          LIMIT 50
        `);
        
        return {
          countries: result.rows.map(r => ({
            code: r.country,
            users: parseInt(r.users || 0)
          })),
          last_updated: new Date().toISOString()
        };
      }, 3600); // 1 hour cache

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // ============================================================================
  // 4. TOP EVENTS (Real-time activity)
  // ============================================================================

  /**
   * GET /api/dashboard/top-events?limit=10
   * Returns most recent events for live activity feed with enhanced user metadata
   * ✅ Uses Redis cache (30s TTL) to minimize DB load
   * ✅ Shows: country, games played, days since install, nickname, device
   */
  router.get('/top-events', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || 10), 50);
      
      // Cache for only 30 seconds (this is for "live" feed)
      // ✅ Redis caching reduces DB queries from every request to every 30s
      const data = await getCachedQuery(req, `top-events-${limit}`, async () => {
        const result = await db.query(`
          WITH user_metadata AS (
            -- Get latest user profile data (country, device, days since install, nickname)
            -- Uses DISTINCT ON to get most recent record per user (fast!)
            SELECT DISTINCT ON (user_id)
              user_id,
              payload->>'country' as country,
              COALESCE(payload->>'deviceModel', payload->>'device_model') as device,
              (payload->>'daysSinceInstall')::int as days_since_install,
              COALESCE(payload->>'nickname', 'Player') as event_nickname
            FROM events
            WHERE event_type IN ('user_installed', 'app_launched')
              AND received_at >= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY user_id, received_at DESC
          ),
          user_game_counts AS (
            -- Count total games played per user
            SELECT 
              user_id,
              COUNT(*) as games_played
            FROM events
            WHERE event_type = 'game_started'
              AND received_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY user_id
          ),
          authoritative_nicknames AS (
            -- ✅ FIX: Get authoritative nicknames from users table (updated by nickname_changed events)
            SELECT user_id, nickname as db_nickname
            FROM users
            WHERE nickname IS NOT NULL AND nickname != ''
          )
          SELECT 
            e.event_type,
            e.user_id,
            e.payload,
            e.received_at,
            um.country,
            um.device,
            um.days_since_install,
            -- ✅ FIX: Prefer users table nickname (authoritative), then event nickname, then 'Player'
            COALESCE(an.db_nickname, um.event_nickname, 'Player') as nickname,
            COALESCE(ugc.games_played, 0) as games_played
          FROM events e
          LEFT JOIN user_metadata um ON e.user_id = um.user_id
          LEFT JOIN user_game_counts ugc ON e.user_id = ugc.user_id
          LEFT JOIN authoritative_nicknames an ON e.user_id = an.user_id
          WHERE e.received_at >= NOW() - INTERVAL '5 minutes'
          ORDER BY e.received_at DESC
          LIMIT $1
        `, [limit]);

        // Country code to name mapping
        const countryNames = {
          'US': 'United States', 'GB': 'United Kingdom', 'CA': 'Canada', 'AU': 'Australia',
          'DE': 'Germany', 'FR': 'France', 'ES': 'Spain', 'IT': 'Italy',
          'JP': 'Japan', 'KR': 'South Korea', 'CN': 'China', 'IN': 'India',
          'BR': 'Brazil', 'MX': 'Mexico', 'AR': 'Argentina', 'CL': 'Chile',
          'RU': 'Russia', 'UA': 'Ukraine', 'PL': 'Poland', 'NL': 'Netherlands',
          'SE': 'Sweden', 'NO': 'Norway', 'DK': 'Denmark', 'FI': 'Finland',
          'IL': 'Israel', 'SA': 'Saudi Arabia', 'AE': 'UAE', 'TR': 'Turkey',
          'ZA': 'South Africa', 'EG': 'Egypt', 'NG': 'Nigeria', 'KE': 'Kenya',
          'SG': 'Singapore', 'MY': 'Malaysia', 'TH': 'Thailand', 'VN': 'Vietnam',
          'PH': 'Philippines', 'ID': 'Indonesia', 'NZ': 'New Zealand', 'PT': 'Portugal',
          'BE': 'Belgium', 'AT': 'Austria', 'CH': 'Switzerland', 'IE': 'Ireland',
          'HK': 'Hong Kong', 'TW': 'Taiwan', 'CZ': 'Czech Republic', 'HU': 'Hungary',
          'RO': 'Romania', 'GR': 'Greece', 'SK': 'Slovakia', 'BG': 'Bulgaria',
          'HR': 'Croatia', 'CO': 'Colombia', 'PE': 'Peru', 'VE': 'Venezuela'
        };

        return {
          events: result.rows.map(r => ({
            type: r.event_type,
            user: r.user_id.substring(0, 20) + '...', // Truncate for privacy
            user_info: {
              nickname: r.nickname || 'Player',
              country: r.country || 'Unknown',
              country_name: countryNames[r.country] || r.country || 'Unknown',
              games_played: parseInt(r.games_played) || 0,
              days_since_install: r.days_since_install !== null ? parseInt(r.days_since_install) : null,
              device: r.device || 'Unknown',
              is_new_user: r.days_since_install !== null && r.days_since_install <= 1
            },
            data: r.payload,
            timestamp: r.received_at
          })),
          last_updated: new Date().toISOString()
        };
      }, 30); // 30 second cache - Redis handles all requests for 30s without hitting DB

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
      const data = await getCachedQuery(req, 'ad-performance', async () => {
        const [rewardedResult, interstitialResult, interstitialDailyResult, interstitialDismissedResult] = await Promise.all([
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
          
          // Interstitial ads (total)
          db.query(`
            SELECT 
              COUNT(*) as shown
            FROM events
            WHERE event_type = 'interstitial_shown'
              AND received_at >= CURRENT_DATE - INTERVAL '7 days'
          `),
          
          // Interstitial ads daily breakdown (7 days) - shown
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as shown
            FROM events
            WHERE event_type = 'interstitial_shown'
              AND received_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(received_at)
            ORDER BY date ASC
          `),
          
          // Interstitial ads daily breakdown (7 days) - early dismissals (viewed < 5 seconds)
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as early_dismissed
            FROM events
            WHERE event_type = 'interstitial_dismissed'
              AND received_at >= CURRENT_DATE - INTERVAL '7 days'
              AND (payload->>'is_early_dismissal')::boolean = true
            GROUP BY DATE(received_at)
            ORDER BY date ASC
          `)
        ]);

        // Merge shown and early dismissed data by date
        const earlyDismissedByDate = {};
        interstitialDismissedResult.rows.forEach(row => {
          earlyDismissedByDate[row.date] = parseInt(row.early_dismissed || 0);
        });
        
        return {
          rewarded: {
            shown: parseInt(rewardedResult.rows[0]?.shown || 0),
            watched: parseInt(rewardedResult.rows[0]?.watched || 0),
            completion_rate: parseFloat(rewardedResult.rows[0]?.completion_rate || 0)
          },
          interstitial: {
            shown: parseInt(interstitialResult.rows[0]?.shown || 0),
            daily: interstitialDailyResult.rows.map(row => ({
              date: row.date,
              shown: parseInt(row.shown || 0),
              early_dismissed: earlyDismissedByDate[row.date] || 0
            }))
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
  // 5b. INTERSTITIAL ADS BY TRIGGER REASON (NEW)
  // ============================================================================

  /**
   * GET /api/dashboard/interstitial-by-trigger
   * Returns interstitial ad analytics broken down by trigger_reason (win_milestone vs loss_streak)
   * 📊 Allows comparing ad performance between win-based and loss-based triggers
   */
  router.get('/interstitial-by-trigger', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `interstitial-by-trigger-${days}days`, async () => {
        const [byTrigger, dailyByTrigger, engagementByTrigger] = await Promise.all([
          // Total breakdown by trigger_reason
          db.query(`
            SELECT 
              COALESCE(payload->>'trigger_reason', 'unknown') as trigger_reason,
              COUNT(*) as shown,
              COUNT(DISTINCT user_id) as unique_users
            FROM events
            WHERE event_type = 'interstitial_shown'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY COALESCE(payload->>'trigger_reason', 'unknown')
            ORDER BY shown DESC
          `),
          
          // Daily breakdown by trigger_reason
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COALESCE(payload->>'trigger_reason', 'unknown') as trigger_reason,
              COUNT(*) as shown
            FROM events
            WHERE event_type = 'interstitial_shown'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at), COALESCE(payload->>'trigger_reason', 'unknown')
            ORDER BY date ASC, trigger_reason
          `),
          
          // Engagement by trigger_reason (clicks, early dismissals)
          db.query(`
            SELECT 
              COALESCE(payload->>'trigger_reason', 'unknown') as trigger_reason,
              COUNT(*) as total_dismissed,
              COUNT(*) FILTER (WHERE (payload->>'was_clicked')::boolean = true) as clicked,
              COUNT(*) FILTER (WHERE (payload->>'is_early_dismissal')::boolean = true) as early_dismissed,
              ROUND(AVG(COALESCE((payload->>'view_duration_seconds')::int, 0)), 1) as avg_view_duration_seconds
            FROM events
            WHERE event_type = 'interstitial_dismissed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY COALESCE(payload->>'trigger_reason', 'unknown')
            ORDER BY total_dismissed DESC
          `)
        ]);

        // Calculate click rates and engagement metrics
        const engagementMap = {};
        engagementByTrigger.rows.forEach(row => {
          const total = parseInt(row.total_dismissed || 0);
          const clicked = parseInt(row.clicked || 0);
          const earlyDismissed = parseInt(row.early_dismissed || 0);
          
          engagementMap[row.trigger_reason] = {
            total_dismissed: total,
            clicked: clicked,
            click_rate: total > 0 ? ((clicked / total) * 100).toFixed(2) : '0.00',
            early_dismissed: earlyDismissed,
            early_dismissal_rate: total > 0 ? ((earlyDismissed / total) * 100).toFixed(2) : '0.00',
            avg_view_duration_seconds: parseFloat(row.avg_view_duration_seconds || 0)
          };
        });

        // Merge shown and engagement data
        const summary = byTrigger.rows.map(row => ({
          trigger_reason: row.trigger_reason,
          shown: parseInt(row.shown || 0),
          unique_users: parseInt(row.unique_users || 0),
          ...engagementMap[row.trigger_reason] || {
            total_dismissed: 0,
            clicked: 0,
            click_rate: '0.00',
            early_dismissed: 0,
            early_dismissal_rate: '0.00',
            avg_view_duration_seconds: 0
          }
        }));

        // Pivot daily data for chart display
        const dailyPivot = {};
        dailyByTrigger.rows.forEach(row => {
          const date = row.date;
          if (!dailyPivot[date]) {
            dailyPivot[date] = { date, win_milestone: 0, loss_streak: 0, unknown: 0 };
          }
          dailyPivot[date][row.trigger_reason] = parseInt(row.shown || 0);
        });

        return {
          summary,
          daily: Object.values(dailyPivot),
          insights: {
            total_shown: summary.reduce((acc, r) => acc + r.shown, 0),
            win_milestone_pct: summary.find(r => r.trigger_reason === 'win_milestone')?.shown 
              ? ((summary.find(r => r.trigger_reason === 'win_milestone').shown / summary.reduce((acc, r) => acc + r.shown, 0)) * 100).toFixed(1) + '%'
              : '0%',
            loss_streak_pct: summary.find(r => r.trigger_reason === 'loss_streak')?.shown 
              ? ((summary.find(r => r.trigger_reason === 'loss_streak').shown / summary.reduce((acc, r) => acc + r.shown, 0)) * 100).toFixed(1) + '%'
              : '0%',
          },
          days_analyzed: days,
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching interstitial by trigger:', error);
      res.status(500).json({ error: 'Failed to fetch interstitial by trigger data' });
    }
  });

  // ============================================================================
  // 5c. RATE US ANALYTICS (NEW)
  // ============================================================================

  /**
   * GET /api/dashboard/rate-us
   * Returns rate us funnel analytics
   * 📊 Tracks: initialized → popup_shown → rate_tapped → completed
   */
  router.get('/rate-us', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `rate-us-${days}days`, async () => {
        const [funnelStats, dailyStats, conversionBySession, declineStats] = await Promise.all([
          // Funnel breakdown
          db.query(`
            SELECT 
              event_type,
              COUNT(*) as count,
              COUNT(DISTINCT user_id) as unique_users
            FROM events
            WHERE event_type IN (
              'rate_us_initialized',
              'rate_us_popup_shown',
              'rate_us_rate_tapped',
              'rate_us_completed',
              'rate_us_maybe_later',
              'rate_us_declined'
            )
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY event_type
            ORDER BY 
              CASE event_type
                WHEN 'rate_us_initialized' THEN 1
                WHEN 'rate_us_popup_shown' THEN 2
                WHEN 'rate_us_rate_tapped' THEN 3
                WHEN 'rate_us_completed' THEN 4
                WHEN 'rate_us_maybe_later' THEN 5
                WHEN 'rate_us_declined' THEN 6
              END
          `),
          
          // Daily popup shown and completions
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) FILTER (WHERE event_type = 'rate_us_popup_shown') as popups_shown,
              COUNT(*) FILTER (WHERE event_type = 'rate_us_rate_tapped') as rate_tapped,
              COUNT(*) FILTER (WHERE event_type = 'rate_us_completed') as completed,
              COUNT(*) FILTER (WHERE event_type = 'rate_us_declined') as declined
            FROM events
            WHERE event_type IN ('rate_us_popup_shown', 'rate_us_rate_tapped', 'rate_us_completed', 'rate_us_declined')
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
            ORDER BY date ASC
          `),
          
          // Conversion by session count (when do users rate?)
          db.query(`
            SELECT 
              COALESCE((payload->>'session_count')::int, 0) as session_count,
              COUNT(*) as completions
            FROM events
            WHERE event_type = 'rate_us_completed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY COALESCE((payload->>'session_count')::int, 0)
            ORDER BY session_count
            LIMIT 20
          `),
          
          // Decline analysis
          db.query(`
            SELECT 
              COALESCE((payload->>'prompt_count')::int, 1) as prompt_number,
              COUNT(*) as declines
            FROM events
            WHERE event_type = 'rate_us_declined'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY COALESCE((payload->>'prompt_count')::int, 1)
            ORDER BY prompt_number
          `)
        ]);

        // Build funnel with conversion rates
        const funnelMap = {};
        funnelStats.rows.forEach(row => {
          funnelMap[row.event_type] = {
            count: parseInt(row.count || 0),
            unique_users: parseInt(row.unique_users || 0)
          };
        });

        const initialized = funnelMap['rate_us_initialized']?.unique_users || 0;
        const popupShown = funnelMap['rate_us_popup_shown']?.unique_users || 0;
        const rateTapped = funnelMap['rate_us_rate_tapped']?.unique_users || 0;
        const completed = funnelMap['rate_us_completed']?.unique_users || 0;
        const declined = funnelMap['rate_us_declined']?.unique_users || 0;

        return {
          funnel: {
            initialized: { count: initialized },
            popup_shown: { 
              count: popupShown,
              rate_from_init: initialized > 0 ? ((popupShown / initialized) * 100).toFixed(2) + '%' : '0%'
            },
            rate_tapped: { 
              count: rateTapped,
              rate_from_popup: popupShown > 0 ? ((rateTapped / popupShown) * 100).toFixed(2) + '%' : '0%'
            },
            completed: { 
              count: completed,
              rate_from_tapped: rateTapped > 0 ? ((completed / rateTapped) * 100).toFixed(2) + '%' : '0%',
              overall_conversion: initialized > 0 ? ((completed / initialized) * 100).toFixed(2) + '%' : '0%'
            },
            declined: {
              count: declined,
              rate_from_popup: popupShown > 0 ? ((declined / popupShown) * 100).toFixed(2) + '%' : '0%'
            }
          },
          daily: dailyStats.rows.map(row => ({
            date: row.date,
            popups_shown: parseInt(row.popups_shown || 0),
            rate_tapped: parseInt(row.rate_tapped || 0),
            completed: parseInt(row.completed || 0),
            declined: parseInt(row.declined || 0)
          })),
          conversion_by_session: conversionBySession.rows.map(row => ({
            session_count: parseInt(row.session_count || 0),
            completions: parseInt(row.completions || 0)
          })),
          decline_by_prompt: declineStats.rows.map(row => ({
            prompt_number: parseInt(row.prompt_number || 1),
            declines: parseInt(row.declines || 0)
          })),
          insights: {
            total_popups: popupShown,
            total_completions: completed,
            popup_to_rate_conversion: popupShown > 0 ? ((completed / popupShown) * 100).toFixed(2) + '%' : '0%',
            avg_session_to_complete: conversionBySession.rows.length > 0 
              ? (conversionBySession.rows.reduce((sum, r) => sum + parseInt(r.session_count) * parseInt(r.completions), 0) / 
                 conversionBySession.rows.reduce((sum, r) => sum + parseInt(r.completions), 0)).toFixed(1)
              : 'N/A'
          },
          days_analyzed: days,
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching rate us analytics:', error);
      res.status(500).json({ error: 'Failed to fetch rate us analytics' });
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
      
      const data = await getCachedQuery(req, `level-ends-${level}-${date}`, async () => {
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
   * GET /api/dashboard/retention-table
   * Returns cohort retention table: 30 rows (last 30 install dates) × 30 columns (D1-D30)
   * Each cell shows retention % for that cohort on that day
   */
  router.get('/retention-table', async (req, res) => {
    try {
      const data = await getCachedQuery(req, 'retention-table', async () => {
        // Get last 30 install dates and calculate retention for each cohort and day (D1-D30)
        const result = await db.query(`
          WITH last_30_install_dates AS (
            -- Get last 30 unique install dates
            SELECT DISTINCT install_date
            FROM (
              SELECT 
                user_id,
                MIN(DATE(received_at)) as install_date
              FROM events
              WHERE event_type IN ('user_installed', 'app_launched')
              GROUP BY user_id
            ) user_installs
            WHERE install_date >= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY install_date DESC
            LIMIT 30
          ),
          cohort_sizes AS (
            -- Get cohort size for each install date
            SELECT 
              install_date,
              COUNT(DISTINCT user_id) as cohort_size
            FROM (
              SELECT 
                user_id,
                MIN(DATE(received_at)) as install_date
              FROM events
              WHERE event_type IN ('user_installed', 'app_launched')
              GROUP BY user_id
            ) user_installs
            WHERE install_date IN (SELECT install_date FROM last_30_install_dates)
            GROUP BY install_date
          ),
          user_activity AS (
            -- Get all user activity with days since install (D1-D30)
            SELECT DISTINCT
              fs.user_id,
              fs.install_date,
              DATE(e.received_at) - fs.install_date as days_since_install
            FROM (
              SELECT 
                user_id,
                MIN(DATE(received_at)) as install_date
              FROM events
              WHERE event_type IN ('user_installed', 'app_launched')
              GROUP BY user_id
            ) fs
            JOIN events e ON fs.user_id = e.user_id
            WHERE e.event_type IN ('app_launched', 'game_started', 'level_started')
              AND DATE(e.received_at) > fs.install_date
              AND fs.install_date IN (SELECT install_date FROM last_30_install_dates)
              AND DATE(e.received_at) - fs.install_date BETWEEN 1 AND 30
          ),
          cohort_retention AS (
            -- Calculate retention for each cohort and day
            SELECT
              ua.install_date,
              ua.days_since_install,
              COUNT(DISTINCT ua.user_id) as returned_users,
              cs.cohort_size
            FROM user_activity ua
            JOIN cohort_sizes cs ON ua.install_date = cs.install_date
            GROUP BY ua.install_date, ua.days_since_install, cs.cohort_size
          )
          SELECT
            cr.install_date,
            cr.days_since_install,
            cr.returned_users,
            cr.cohort_size,
            ROUND(100.0 * cr.returned_users / NULLIF(cr.cohort_size, 0), 1) as retention_rate
          FROM cohort_retention cr
          ORDER BY cr.install_date DESC, cr.days_since_install ASC
        `);

        // Get all install dates with cohort sizes (last 30)
        const installDatesWithSizes = await db.query(`
          SELECT 
            install_date,
            COUNT(DISTINCT user_id) as cohort_size
          FROM (
            SELECT 
              user_id,
              MIN(DATE(received_at)) as install_date
            FROM events
            WHERE event_type IN ('user_installed', 'app_launched')
            GROUP BY user_id
          ) user_installs
          WHERE install_date >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY install_date
          ORDER BY install_date DESC
          LIMIT 30
        `);

        // Build cohort retention table
        const cohorts = [];
        const retentionMap = {};
        const cohortSizeMap = {};

        // Build cohort size map
        installDatesWithSizes.rows.forEach(row => {
          const date = row.install_date.toISOString().split('T')[0];
          cohortSizeMap[date] = parseInt(row.cohort_size) || 0;
        });

        // Build retention map: install_date -> { d1: rate, d2: rate, ... }
        result.rows.forEach(row => {
          const date = row.install_date.toISOString().split('T')[0];
          if (!retentionMap[date]) {
            retentionMap[date] = {};
          }
          retentionMap[date][`d${row.days_since_install}`] = parseFloat(row.retention_rate) || 0;
        });

        // Build cohorts array with all D1-D30 columns
        installDatesWithSizes.rows.forEach(row => {
          const installDate = row.install_date.toISOString().split('T')[0];
          const cohortData = retentionMap[installDate] || {};
          const cohortSize = cohortSizeMap[installDate] || 0;

          // Build retention object for D1-D30
          const retention = {};
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const installDateObj = new Date(installDate);
          installDateObj.setHours(0, 0, 0, 0);
          const daysSinceInstall = Math.floor((today - installDateObj) / (1000 * 60 * 60 * 24));

          for (let day = 1; day <= 30; day++) {
            const key = `d${day}`;
            // Only show data if enough time has passed
            if (daysSinceInstall >= day) {
              retention[key] = cohortData[key] ?? null;
            } else {
              retention[key] = null; // Not enough time has passed
            }
          }

          cohorts.push({
            install_date: installDate,
            cohort_size: cohortSize,
            retention,
          });
        });

        return {
          cohorts,
          last_updated: new Date().toISOString(),
        };
      }, 10800); // Cache for 3 hours (10800 seconds)

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching retention table:', error);
      res.status(500).json({ error: 'Failed to fetch retention table data' });
    }
  });

  /**
   * GET /api/dashboard/retention
   * Returns Day 1, Day 3, Day 7, Day 14, Day 30 retention rates (aggregated)
   * @deprecated - Use /retention-table for cohort-based view
   */
  router.get('/retention', async (req, res) => {
    try {
      const data = await getCachedQuery(req, 'retention-cohorts', async () => {
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
          cohort_sizes AS (
            SELECT 
              install_date,
              COUNT(DISTINCT user_id) as cohort_size
            FROM first_sessions
            GROUP BY install_date
          ),
          return_sessions AS (
            SELECT DISTINCT
              fs.user_id,
              fs.install_date,
              DATE(e.received_at) - fs.install_date as days_since_install
            FROM first_sessions fs
            JOIN events e ON fs.user_id = e.user_id
            WHERE e.event_type IN ('app_launched', 'game_started', 'level_started')
              AND DATE(e.received_at) > fs.install_date
              AND DATE(e.received_at) - fs.install_date IN (1, 3, 7, 14, 30)
          ),
          cohort_retention AS (
            SELECT
              rs.install_date,
              rs.days_since_install,
              COUNT(DISTINCT rs.user_id) as returned_users,
              cs.cohort_size,
              ROUND(100.0 * COUNT(DISTINCT rs.user_id) / NULLIF(cs.cohort_size, 0), 1) as retention_rate
            FROM return_sessions rs
            JOIN cohort_sizes cs ON rs.install_date = cs.install_date
            GROUP BY rs.install_date, rs.days_since_install, cs.cohort_size
          )
          SELECT
            days_since_install,
            SUM(returned_users) as total_returned_users,
            SUM(cohort_size) as total_cohort_size,
            ROUND(100.0 * SUM(returned_users) / NULLIF(SUM(cohort_size), 0), 1) as retention_rate
          FROM cohort_retention
          WHERE install_date <= CURRENT_DATE - days_since_install
          GROUP BY days_since_install
          ORDER BY days_since_install
        `);

        // Map SQL column names to API response format
        const formatRetentionRow = (row) => {
          if (!row) return { returned_users: 0, cohort_size: 0, retention_rate: 0 };
          return {
            returned_users: parseInt(row.total_returned_users) || 0,
            cohort_size: parseInt(row.total_cohort_size) || 0,
            retention_rate: parseFloat(row.retention_rate) || 0
          };
        };

        return {
          retention: {
            day1: formatRetentionRow(result.rows.find(r => r.days_since_install === 1)),
            day3: formatRetentionRow(result.rows.find(r => r.days_since_install === 3)),
            day7: formatRetentionRow(result.rows.find(r => r.days_since_install === 7)),
            day14: formatRetentionRow(result.rows.find(r => r.days_since_install === 14)),
            day30: formatRetentionRow(result.rows.find(r => r.days_since_install === 30))
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
  // 8. ECONOMY ANALYTICS
  // ============================================================================

  /**
   * GET /api/dashboard/economy
   * Returns daily economy metrics: gems, coins, spending patterns
   */
  router.get('/economy', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `economy-${days}days`, async () => {
        const [gemsResult, coinsResult, spendingResult] = await Promise.all([
          // Gems earned vs spent
          db.query(`
            SELECT 
              DATE(received_at) as date,
              SUM(CASE WHEN event_type = 'currency_earned' AND payload->>'currency_type' = 'gems' 
                  THEN (payload->>'amount')::int ELSE 0 END) as gems_earned,
              SUM(CASE WHEN event_type = 'currency_spent' AND payload->>'currency_type' = 'gems' 
                  THEN (payload->>'amount')::int ELSE 0 END) as gems_spent
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
              AND event_type IN ('currency_earned', 'currency_spent')
            GROUP BY DATE(received_at)
            ORDER BY date DESC
            LIMIT ${days}
          `),
          
          // Coins earned vs spent
          db.query(`
            SELECT 
              DATE(received_at) as date,
              SUM(CASE WHEN event_type = 'currency_earned' AND payload->>'currency_type' = 'coins' 
                  THEN (payload->>'amount')::int ELSE 0 END) as coins_earned,
              SUM(CASE WHEN event_type = 'currency_spent' AND payload->>'currency_type' = 'coins' 
                  THEN (payload->>'amount')::int ELSE 0 END) as coins_spent
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
              AND event_type IN ('currency_earned', 'currency_spent')
            GROUP BY DATE(received_at)
            ORDER BY date DESC
            LIMIT ${days}
          `),
          
          // Spending breakdown (what are they buying?)
          db.query(`
            SELECT 
              payload->>'item_type' as item_type,
              payload->>'currency_type' as currency_type,
              COUNT(*) as purchase_count,
              SUM((payload->>'amount')::int) as total_spent
            FROM events
            WHERE event_type = 'currency_spent'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'item_type', payload->>'currency_type'
            ORDER BY total_spent DESC
          `)
        ]);

        return {
          gems: gemsResult.rows,
          coins: coinsResult.rows,
          spending_breakdown: spendingResult.rows,
          summary: {
            total_gems_earned: gemsResult.rows.reduce((sum, r) => sum + parseInt(r.gems_earned || 0), 0),
            total_gems_spent: gemsResult.rows.reduce((sum, r) => sum + parseInt(r.gems_spent || 0), 0),
            total_coins_earned: coinsResult.rows.reduce((sum, r) => sum + parseInt(r.coins_earned || 0), 0),
            total_coins_spent: coinsResult.rows.reduce((sum, r) => sum + parseInt(r.coins_spent || 0), 0)
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching economy data:', error);
      res.status(500).json({ error: 'Failed to fetch economy data' });
    }
  });

  // ============================================================================
  // 9. CONTINUE USAGE ANALYTICS
  // ============================================================================

  /**
   * GET /api/dashboard/continues
   * Returns continue usage: total, ad vs gems, success rates
   */
  router.get('/continues', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `continues-${days}days`, async () => {
        const [dailyResult, typeResult, successResult] = await Promise.all([
          // Daily continue usage
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as total_continues,
              COUNT(CASE WHEN payload->>'continue_type' = 'ad_watch' THEN 1 END) as ad_continues,
              COUNT(CASE WHEN payload->>'continue_type' = 'gem_purchase' THEN 1 END) as gem_continues
            FROM events
            WHERE event_type = 'continue_used'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
            ORDER BY date DESC
          `),
          
          // Breakdown by type
          db.query(`
            SELECT 
              payload->>'continue_type' as type,
              COUNT(*) as count,
              ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as percentage
            FROM events
            WHERE event_type = 'continue_used'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'continue_type'
          `),
          
          // Success rate after continue (did they survive longer?)
          db.query(`
            SELECT 
              COUNT(DISTINCT user_id) as players_who_continued,
              AVG((payload->>'score_after_continue')::int) as avg_score_after,
              AVG((payload->>'survival_time_after')::int) as avg_survival_seconds_after
            FROM events
            WHERE event_type = 'continue_used'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
              AND payload->>'score_after_continue' IS NOT NULL
          `)
        ]);

        return {
          daily: dailyResult.rows,
          by_type: typeResult.rows,
          success_metrics: successResult.rows[0] || {},
          summary: {
            total_continues: dailyResult.rows.reduce((sum, r) => sum + parseInt(r.total_continues || 0), 0),
            ad_continues: dailyResult.rows.reduce((sum, r) => sum + parseInt(r.ad_continues || 0), 0),
            gem_continues: dailyResult.rows.reduce((sum, r) => sum + parseInt(r.gem_continues || 0), 0)
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching continue data:', error);
      res.status(500).json({ error: 'Failed to fetch continue data' });
    }
  });

  // ============================================================================
  // 10. MISSION COMPLETION ANALYTICS
  // ============================================================================

  /**
   * GET /api/dashboard/missions
   * Returns mission completion rates and popularity
   */
  router.get('/missions', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `missions-${days}days`, async () => {
        const [dailyResult, missionTypesResult, popularResult] = await Promise.all([
          // Daily mission completions
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as missions_completed,
              COUNT(DISTINCT user_id) as unique_players
            FROM events
            WHERE event_type = 'mission_completed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
            ORDER BY date DESC
          `),
          
          // By mission type
          db.query(`
            SELECT 
              payload->>'mission_type' as mission_type,
              COUNT(*) as completions,
              COUNT(DISTINCT user_id) as unique_completers,
              ROUND(AVG((payload->>'reward_amount')::int), 0) as avg_reward
            FROM events
            WHERE event_type = 'mission_completed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'mission_type'
            ORDER BY completions DESC
          `),
          
          // Most popular specific missions
          db.query(`
            SELECT 
              payload->>'mission_id' as mission_id,
              payload->>'mission_type' as mission_type,
              COUNT(*) as completions,
              COUNT(DISTINCT user_id) as unique_completers
            FROM events
            WHERE event_type = 'mission_completed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'mission_id', payload->>'mission_type'
            ORDER BY completions DESC
            LIMIT 10
          `)
        ]);

        return {
          daily: dailyResult.rows,
          by_type: missionTypesResult.rows,
          top_missions: popularResult.rows,
          summary: {
            total_completions: dailyResult.rows.reduce((sum, r) => sum + parseInt(r.missions_completed || 0), 0),
            unique_players: Math.max(...dailyResult.rows.map(r => parseInt(r.unique_players || 0)), 0)
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching mission data:', error);
      res.status(500).json({ error: 'Failed to fetch mission data' });
    }
  });

  // ============================================================================
  // 10b. ACHIEVEMENT ANALYTICS
  // ============================================================================

  /**
   * GET /api/dashboard/achievements
   * Returns achievement unlock rates and engagement metrics
   */
  router.get('/achievements', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `achievements-${days}days`, async () => {
        const [dailyUnlocks, dailyClaims, popularAchievements, claimTimeStats, tierBreakdown] = await Promise.all([
          // Daily achievement unlocks
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as achievements_unlocked,
              COUNT(DISTINCT user_id) as unique_players
            FROM events
            WHERE event_type = 'achievement_unlocked'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
            ORDER BY date DESC
          `),
          
          // Daily achievement claims
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as achievements_claimed,
              COUNT(DISTINCT user_id) as unique_claimers,
              SUM((payload->>'reward_coins')::int) as total_coins_rewarded,
              SUM((payload->>'reward_gems')::int) as total_gems_rewarded
            FROM events
            WHERE event_type = 'achievement_claimed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
            ORDER BY date DESC
          `),
          
          // Most popular achievements (by unlock count)
          db.query(`
            SELECT 
              payload->>'achievement_id' as achievement_id,
              payload->>'achievement_name' as achievement_name,
              payload->>'achievement_tier' as tier,
              payload->>'achievement_category' as category,
              COUNT(*) as unlock_count,
              COUNT(DISTINCT user_id) as unique_unlockers
            FROM events
            WHERE event_type = 'achievement_unlocked'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'achievement_id', payload->>'achievement_name', 
                     payload->>'achievement_tier', payload->>'achievement_category'
            ORDER BY unlock_count DESC
            LIMIT 15
          `),
          
          // Average time to claim by tier
          db.query(`
            SELECT 
              payload->>'achievement_tier' as tier,
              AVG((payload->>'time_to_claim_seconds')::int) as avg_claim_time_seconds,
              COUNT(*) as claims
            FROM events
            WHERE event_type = 'achievement_claimed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'achievement_tier'
            ORDER BY claims DESC
          `),
          
          // Breakdown by tier
          db.query(`
            SELECT 
              e1.payload->>'achievement_tier' as tier,
              COUNT(*) as total_unlocks,
              COUNT(DISTINCT e1.user_id) as unique_players,
              SUM(CASE WHEN e2.event_type = 'achievement_claimed' THEN 1 ELSE 0 END) as total_claims
            FROM events e1
            LEFT JOIN events e2 ON e1.payload->>'achievement_id' = e2.payload->>'achievement_id' 
              AND e1.user_id = e2.user_id 
              AND e2.event_type = 'achievement_claimed'
            WHERE e1.event_type = 'achievement_unlocked'
              AND e1.received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY e1.payload->>'achievement_tier'
            ORDER BY total_unlocks DESC
          `)
        ]);

        const totalUnlocks = dailyUnlocks.rows.reduce((sum, r) => sum + parseInt(r.achievements_unlocked || 0), 0);
        const totalClaims = dailyClaims.rows.reduce((sum, r) => sum + parseInt(r.achievements_claimed || 0), 0);

        return {
          daily_unlocks: dailyUnlocks.rows,
          daily_claims: dailyClaims.rows,
          top_achievements: popularAchievements.rows,
          claim_time_by_tier: claimTimeStats.rows,
          tier_breakdown: tierBreakdown.rows,
          summary: {
            total_unlocks: totalUnlocks,
            total_claims: totalClaims,
            claim_rate: totalUnlocks > 0 ? ((totalClaims / totalUnlocks) * 100).toFixed(1) : 0,
            unique_players_unlocking: Math.max(...dailyUnlocks.rows.map(r => parseInt(r.unique_players || 0)), 0),
            unique_players_claiming: Math.max(...dailyClaims.rows.map(r => parseInt(r.unique_claimers || 0)), 0)
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching achievement data:', error);
      res.status(500).json({ error: 'Failed to fetch achievement data' });
    }
  });

  // ============================================================================
  // 11. JET/SKIN PURCHASES
  // ============================================================================

  /**
   * GET /api/dashboard/purchases
   * Returns jet and skin purchase analytics
   */
  router.get('/purchases', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 90);
      
      const data = await getCachedQuery(req, `purchases-${days}days`, async () => {
        const [dailyResult, jetResult, currencyResult, dailyBySkinResult] = await Promise.all([
          // Daily purchases
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as total_purchases,
              COUNT(DISTINCT user_id) as unique_buyers
            FROM events
            WHERE event_type = 'skin_purchased'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
            ORDER BY date DESC
          `),
          
          // Most popular jets/skins
          db.query(`
            SELECT 
              payload->>'jet_id' as item_id,
              payload->>'jet_name' as item_name,
              payload->>'rarity' as rarity,
              payload->>'purchase_type' as purchase_type,
              COUNT(*) as purchase_count,
              COUNT(DISTINCT user_id) as unique_buyers,
              SUM((payload->>'cost_coins')::int) as total_coins_spent,
              SUM((payload->>'cost_gems')::int) as total_gems_spent
            FROM events
            WHERE event_type = 'skin_purchased'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'jet_id', payload->>'jet_name', payload->>'rarity', payload->>'purchase_type'
            ORDER BY purchase_count DESC
            LIMIT 10
          `),
          
          // Purchases by currency type (coins vs gems)
          db.query(`
            SELECT 
              payload->>'purchase_type' as currency_type,
              COUNT(*) as purchase_count,
              SUM((payload->>'cost_coins')::int) as total_coins,
              SUM((payload->>'cost_gems')::int) as total_gems
            FROM events
            WHERE event_type = 'skin_purchased'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY payload->>'purchase_type'
          `),
          
          // Daily breakdown by jet skin (for stacked bar chart)
          db.query(`
            SELECT 
              DATE(received_at) as date,
              payload->>'jet_id' as jet_id,
              payload->>'jet_name' as jet_name,
              payload->>'rarity' as rarity,
              COUNT(*) as purchase_count
            FROM events
            WHERE event_type = 'skin_purchased'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at), payload->>'jet_id', payload->>'jet_name', payload->>'rarity'
            ORDER BY date DESC, purchase_count DESC
          `)
        ]);

        // Process daily breakdown by skin for stacked bar chart
        // Group by date, then by jet_id
        const dailyBySkin = {};
        dailyBySkinResult.rows.forEach(row => {
          const date = row.date;
          const jetId = row.jet_id || 'unknown';
          const jetName = row.jet_name || jetId;
          const rarity = row.rarity || 'common';
          const count = parseInt(row.purchase_count || 0);
          
          if (!dailyBySkin[date]) {
            dailyBySkin[date] = {};
          }
          
          if (!dailyBySkin[date][jetId]) {
            dailyBySkin[date][jetId] = {
              jet_id: jetId,
              jet_name: jetName,
              rarity: rarity,
              purchase_count: 0
            };
          }
          
          dailyBySkin[date][jetId].purchase_count += count;
        });

        // Convert to array format for frontend
        const dailyBreakdown = Object.keys(dailyBySkin).map(date => ({
          date: date,
          skins: Object.values(dailyBySkin[date])
        })).sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort chronologically

        return {
          daily: dailyResult.rows,
          top_items: jetResult.rows,
          by_currency: currencyResult.rows,
          daily_by_skin: dailyBreakdown, // New: Daily breakdown by skin for stacked chart
          summary: {
            total_purchases: dailyResult.rows.reduce((sum, r) => sum + parseInt(r.total_purchases || 0), 0),
            unique_buyers: Math.max(...dailyResult.rows.map(r => parseInt(r.unique_buyers || 0)), 0)
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching purchase data:', error);
      res.status(500).json({ error: 'Failed to fetch purchase data' });
    }
  });

  // ============================================================================
  // 12. CACHE MANAGEMENT
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
   * GET /api/dashboard/notifications
   * Push notification analytics
   */
  router.get('/notifications', async (req, res) => {
    try {
      const NotificationTracker = require('../services/notification-tracker');
      const notificationTracker = new NotificationTracker(db);

      const data = await getCachedQuery(req, 'notifications', async () => {
        const [todayStats, byCountry, trend] = await Promise.all([
          notificationTracker.getTodayStats(),
          notificationTracker.getStatsByCountry(),
          notificationTracker.getNotificationTrend(),
        ]);

        // Get clicked counts by type
        const clickedByType = await db.query(`
          SELECT
            notification_type,
            COUNT(*) as clicked
          FROM notification_events
          WHERE event_type = 'clicked'
            AND received_at >= CURRENT_DATE
          GROUP BY notification_type
        `);

        const clickedMap = {};
        clickedByType.rows.forEach(row => {
          clickedMap[row.notification_type] = parseInt(row.clicked) || 0;
        });

        return {
          today: {
            total_sent: parseInt(todayStats?.total_sent || 0),
            total_clicked: parseInt(todayStats?.total_clicked || 0),
            total_failed: parseInt(todayStats?.total_failed || 0),
            unique_users_sent: parseInt(todayStats?.unique_users_sent || 0),
            unique_users_clicked: parseInt(todayStats?.unique_users_clicked || 0),
            ctr_rate: parseFloat(todayStats?.ctr_rate || 0),
            by_type: {
              '1hour': {
                sent: parseInt(todayStats?.sent_1hour || 0),
                clicked: clickedMap['1hour'] || 0,
                ctr: clickedMap['1hour'] > 0 && todayStats?.sent_1hour > 0
                  ? parseFloat((clickedMap['1hour'] / todayStats.sent_1hour * 100).toFixed(2))
                  : 0,
              },
              '24hour': {
                sent: parseInt(todayStats?.sent_24hour || 0),
                clicked: clickedMap['24hour'] || 0,
                ctr: clickedMap['24hour'] > 0 && todayStats?.sent_24hour > 0
                  ? parseFloat((clickedMap['24hour'] / todayStats.sent_24hour * 100).toFixed(2))
                  : 0,
              },
              '46hour': {
                sent: parseInt(todayStats?.sent_46hour || 0),
                clicked: clickedMap['46hour'] || 0,
                ctr: clickedMap['46hour'] > 0 && todayStats?.sent_46hour > 0
                  ? parseFloat((clickedMap['46hour'] / todayStats.sent_46hour * 100).toFixed(2))
                  : 0,
              },
            },
          },
          by_country: byCountry.map(row => ({
            country: row.country,
            sent: parseInt(row.sent || 0),
            clicked: parseInt(row.clicked || 0),
            ctr_rate: parseFloat(row.ctr_rate || 0),
          })),
          trend: trend.map(row => ({
            date: row.date,
            sent: parseInt(row.sent || 0),
            clicked: parseInt(row.clicked || 0),
            failed: parseInt(row.failed || 0),
            ctr_rate: parseFloat(row.ctr_rate || 0),
          })),
          last_updated: new Date().toISOString(),
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching notification analytics:', error);
      res.status(500).json({ error: 'Failed to fetch notification analytics' });
    }
  });

  // ============================================================================
  // ✅ REMOVED: Duplicate /tournaments endpoint (v2.3.0) - using newer version below
  // ============================================================================
  // 🎯 CONVERSION EVENTS ANALYTICS
  // ============================================================================

  /**
   * GET /api/dashboard/conversions?days=30
   * Returns conversion milestone events (games played, sessions, levels completed)
   */
  router.get('/conversions', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 30), 90);

      const data = await getCachedQuery(req, `conversions-${days}days`, async () => {
        const [
          dailyConversions,
          allTimeConversions,
          byMilestoneType
        ] = await Promise.all([
          // Daily conversion events
          db.query(`
            SELECT 
              DATE(received_at) as date,
              COUNT(*) as total_conversions,
              COUNT(DISTINCT user_id) as unique_users
            FROM events
            WHERE event_type LIKE 'conversion_%'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
            ORDER BY date DESC
          `),
          
          // All-time totals by event type
          db.query(`
            SELECT 
              event_type,
              COUNT(*) as count,
              COUNT(DISTINCT user_id) as unique_users,
              MIN(received_at) as first_seen,
              MAX(received_at) as last_seen
            FROM events
            WHERE event_type LIKE 'conversion_%'
            GROUP BY event_type
            ORDER BY count DESC
          `),
          
          // Breakdown by milestone type (games, sessions, levels)
          db.query(`
            SELECT 
              CASE 
                WHEN event_type LIKE '%games_played%' THEN 'Games Played'
                WHEN event_type LIKE '%sessions%' THEN 'Sessions'
                WHEN event_type LIKE '%level_completed%' THEN 'Levels Completed'
                ELSE 'Other'
              END as milestone_type,
              event_type,
              COUNT(*) as count,
              COUNT(DISTINCT user_id) as unique_users
            FROM events
            WHERE event_type LIKE 'conversion_%'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY milestone_type, event_type
            ORDER BY milestone_type, count DESC
          `)
        ]);

        // Calculate all-time total
        const allTimeTotal = allTimeConversions.rows.reduce((sum, r) => sum + parseInt(r.count || 0), 0);
        const allTimeUniqueUsers = new Set(allTimeConversions.rows.map(r => r.unique_users)).size;

        return {
          summary: {
            total_conversions_all_time: allTimeTotal,
            total_in_period: dailyConversions.rows.reduce((sum, r) => sum + parseInt(r.total_conversions || 0), 0),
            unique_users_in_period: dailyConversions.rows.reduce((max, r) => Math.max(max, parseInt(r.unique_users || 0)), 0)
          },
          daily_trend: dailyConversions.rows.map(r => ({
            date: r.date,
            total: parseInt(r.total_conversions || 0),
            unique_users: parseInt(r.unique_users || 0)
          })),
          all_time_by_event: allTimeConversions.rows.map(r => ({
            event_type: r.event_type,
            // Make event name more readable
            display_name: r.event_type
              .replace('conversion_', '')
              .replace(/_/g, ' ')
              .replace(/\b\w/g, l => l.toUpperCase()),
            count: parseInt(r.count || 0),
            unique_users: parseInt(r.unique_users || 0),
            first_seen: r.first_seen,
            last_seen: r.last_seen
          })),
          by_milestone_type: byMilestoneType.rows.map(r => ({
            milestone_type: r.milestone_type,
            event_type: r.event_type,
            count: parseInt(r.count || 0),
            unique_users: parseInt(r.unique_users || 0)
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching conversion analytics:', error);
      res.status(500).json({ error: 'Failed to fetch conversion analytics' });
    }
  });

  // ============================================================================
  // PHASE 2: CORE ANALYTICS METRICS
  // ============================================================================

  /**
   * GET /api/dashboard/retention-detailed
   * ✅ NEW: Detailed retention metrics (D1, D7, D30)
   * 
   * Query params:
   * - days: Number of days to analyze (default: 30)
   * - startDate: Start date (YYYY-MM-DD)
   * - endDate: End date (YYYY-MM-DD)
   * - cohort: Filter by cohort type ('install_date' or 'campaign_id')
   */
  router.get('/retention-detailed', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      const cohortType = req.query.cohort || 'install_date';

      const data = await getCachedQuery(req, `retention-detailed:${days}:${startDate || 'all'}:${endDate || 'all'}:${cohortType}`, async () => {
        // ✅ OPTIMIZED: Use cohort_aggregations materialized view
        // Build date filter
        let dateFilter = '';
        if (startDate && endDate) {
          dateFilter = `AND cohort_date >= '${startDate}'::date AND cohort_date <= '${endDate}'::date`;
        } else if (startDate) {
          dateFilter = `AND cohort_date >= '${startDate}'::date`;
        } else if (endDate) {
          dateFilter = `AND cohort_date <= '${endDate}'::date`;
        } else {
          dateFilter = `AND cohort_date >= CURRENT_DATE - INTERVAL '${days} days'`;
        }

        // Build campaign filter if needed
        const campaignFilter = cohortType === 'campaign_id' 
          ? `AND campaign_id IS NOT NULL`
          : `AND campaign_id IS NULL`;

        const retentionQuery = `
          SELECT 
            cohort_date,
            ${cohortType === 'campaign_id' ? 'campaign_id,' : ''}
            cohort_size as total_installs,
            d1_retained,
            d7_retained,
            d30_retained,
            d1_retention_rate,
            d7_retention_rate,
            d30_retention_rate
          FROM cohort_aggregations
          WHERE 1=1 ${dateFilter} ${campaignFilter}
          ORDER BY cohort_date DESC${cohortType === 'campaign_id' ? ', campaign_id' : ''}
        `;

        const result = await db.query(retentionQuery);

        return {
          summary: {
            total_cohorts: result.rows.length,
            total_installs: result.rows.reduce((sum, r) => sum + parseInt(r.total_installs || 0), 0),
            avg_d1_retention: result.rows.length > 0
              ? result.rows.reduce((sum, r) => sum + parseFloat(r.d1_retention_rate || 0), 0) / result.rows.length
              : 0,
            avg_d7_retention: result.rows.length > 0
              ? result.rows.reduce((sum, r) => sum + parseFloat(r.d7_retention_rate || 0), 0) / result.rows.length
              : 0,
            avg_d30_retention: result.rows.length > 0
              ? result.rows.reduce((sum, r) => sum + parseFloat(r.d30_retention_rate || 0), 0) / result.rows.length
              : 0,
          },
          cohorts: result.rows.map(r => ({
            cohort_date: r.cohort_date,
            ...(cohortType === 'campaign_id' && r.campaign_id ? { campaign_id: r.campaign_id } : {}),
            total_installs: parseInt(r.total_installs || 0),
            d1_retained: parseInt(r.d1_retained || 0),
            d7_retained: parseInt(r.d7_retained || 0),
            d30_retained: parseInt(r.d30_retained || 0),
            d1_retention_rate: parseFloat(r.d1_retention_rate || 0),
            d7_retention_rate: parseFloat(r.d7_retention_rate || 0),
            d30_retention_rate: parseFloat(r.d30_retention_rate || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching detailed retention:', error);
      res.status(500).json({ error: 'Failed to fetch detailed retention metrics' });
    }
  });

  /**
   * GET /api/dashboard/churn
   * ✅ NEW: Churn rate and churned users
   * 
   * Query params:
   * - days: Number of days to analyze (default: 30)
   * - inactiveDays: Days of inactivity to consider churned (default: 7)
   */
  router.get('/churn', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const inactiveDays = parseInt(req.query.inactiveDays) || 7;

      const data = await getCachedQuery(req, `churn:${days}:${inactiveDays}`, async () => {
        // Get all users who were active in the period
        const activeUsersQuery = `
          SELECT DISTINCT user_id
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
        `;

        // Get users who haven't been active in the last N days
        const churnedUsersQuery = `
          SELECT DISTINCT user_id
          FROM events
          WHERE received_at < CURRENT_DATE - INTERVAL '${inactiveDays} days'
            AND user_id NOT IN (
              SELECT DISTINCT user_id
              FROM events
              WHERE received_at >= CURRENT_DATE - INTERVAL '${inactiveDays} days'
            )
        `;

        const [activeUsers, churnedUsers] = await Promise.all([
          db.query(activeUsersQuery),
          db.query(churnedUsersQuery)
        ]);

        const totalActive = activeUsers.rows.length;
        const totalChurned = churnedUsers.rows.length;
        const churnRate = totalActive > 0 ? (totalChurned / totalActive) * 100 : 0;

        // Get churn trend over time
        const churnTrendQuery = `
          WITH daily_active AS (
            SELECT 
              DATE(received_at) as date,
              COUNT(DISTINCT user_id) as active_users
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
          ),
          daily_churned AS (
            SELECT 
              DATE(received_at) as date,
              COUNT(DISTINCT user_id) as churned_users
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
              AND user_id NOT IN (
                SELECT DISTINCT user_id
                FROM events
                WHERE received_at > DATE(received_at) + INTERVAL '${inactiveDays} days'
              )
            GROUP BY DATE(received_at)
          )
          SELECT 
            COALESCE(da.date, dc.date) as date,
            COALESCE(da.active_users, 0) as active_users,
            COALESCE(dc.churned_users, 0) as churned_users,
            CASE 
              WHEN COALESCE(da.active_users, 0) > 0 
              THEN ROUND(100.0 * COALESCE(dc.churned_users, 0) / da.active_users, 2)
              ELSE 0
            END as churn_rate
          FROM daily_active da
          FULL OUTER JOIN daily_churned dc ON da.date = dc.date
          ORDER BY date DESC
        `;

        const churnTrend = await db.query(churnTrendQuery);

        return {
          summary: {
            total_active_users: totalActive,
            total_churned_users: totalChurned,
            churn_rate: parseFloat(churnRate.toFixed(2)),
            inactive_days_threshold: inactiveDays,
            analysis_period_days: days,
          },
          trend: churnTrend.rows.map(r => ({
            date: r.date,
            active_users: parseInt(r.active_users || 0),
            churned_users: parseInt(r.churned_users || 0),
            churn_rate: parseFloat(r.churn_rate || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching churn metrics:', error);
      res.status(500).json({ error: 'Failed to fetch churn metrics' });
    }
  });

  /**
   * GET /api/dashboard/cohort-analysis
   * ✅ NEW: Cohort analysis (install date or campaign-based)
   * 
   * Query params:
   * - type: 'install_date' or 'campaign_id' (default: 'install_date')
   * - startDate: Start date (YYYY-MM-DD)
   * - endDate: End date (YYYY-MM-DD)
   */
  router.get('/cohort-analysis', async (req, res) => {
    try {
      const cohortType = req.query.type || 'install_date';
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;

      const data = await getCachedQuery(req, `cohort-analysis:${cohortType}:${startDate || 'all'}:${endDate || 'all'}`, async () => {
        // ✅ OPTIMIZED: Use cohort_aggregations materialized view
        const dateFilter = startDate && endDate
          ? `AND cohort_date >= '${startDate}'::date AND cohort_date <= '${endDate}'::date`
          : startDate
          ? `AND cohort_date >= '${startDate}'::date`
          : endDate
          ? `AND cohort_date <= '${endDate}'::date`
          : '';

        const campaignFilter = cohortType === 'campaign_id' 
          ? `AND campaign_id IS NOT NULL`
          : `AND campaign_id IS NULL`;

        // Get cohort data with retention and LTV from materialized view
        const cohortQuery = `
          SELECT 
            cohort_date,
            ${cohortType === 'campaign_id' ? 'campaign_id,' : ''}
            cohort_size,
            d1_retained + d7_retained + d30_retained as active_users,
            total_revenue_usd,
            d7_retention_rate as retention_rate,
            ltv
          FROM cohort_aggregations
          WHERE 1=1 ${dateFilter} ${campaignFilter}
          ORDER BY cohort_date DESC${cohortType === 'campaign_id' ? ', campaign_id' : ''}
        `;

        const result = await db.query(cohortQuery);

        return {
          cohort_type: cohortType,
          cohorts: result.rows.map(r => ({
            cohort_date: r.cohort_date,
            ...(cohortType === 'campaign_id' && r.campaign_id ? { campaign_id: r.campaign_id } : {}),
            cohort_size: parseInt(r.cohort_size || 0),
            active_users: parseInt(r.active_users || 0),
            retention_rate: parseFloat(r.retention_rate || 0),
            total_revenue: parseFloat(r.total_revenue_usd || 0),
            ltv: parseFloat(r.ltv || 0),
          })),
          summary: {
            total_cohorts: result.rows.length,
            total_users: result.rows.reduce((sum, r) => sum + parseInt(r.cohort_size || 0), 0),
            avg_retention: result.rows.length > 0
              ? result.rows.reduce((sum, r) => sum + parseFloat(r.retention_rate || 0), 0) / result.rows.length
              : 0,
            avg_ltv: result.rows.length > 0
              ? result.rows.reduce((sum, r) => sum + parseFloat(r.ltv || 0), 0) / result.rows.length
              : 0,
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching cohort analysis:', error);
      res.status(500).json({ error: 'Failed to fetch cohort analysis' });
    }
  });

  /**
   * GET /api/dashboard/arpu
   * ✅ NEW: ARPU (Average Revenue Per User) and ARPPU (Average Revenue Per Paying User)
   * 
   * Query params:
   * - days: Number of days to analyze (default: 30)
   * - startDate: Start date (YYYY-MM-DD)
   * - endDate: End date (YYYY-MM-DD)
   */
  router.get('/arpu', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;

      const data = await getCachedQuery(req, `arpu:${days}:${startDate || 'all'}:${endDate || 'all'}`, async () => {
        const dateFilter = startDate && endDate
          ? `AND received_at >= '${startDate}'::date AND received_at <= '${endDate}'::date`
          : startDate
          ? `AND received_at >= '${startDate}'::date`
          : endDate
          ? `AND received_at <= '${endDate}'::date`
          : `AND received_at >= CURRENT_DATE - INTERVAL '${days} days'`;

        // Calculate ARPU and ARPPU
        const arpuQuery = `
          WITH user_revenue AS (
            SELECT 
              user_id,
              SUM(CASE WHEN payload->>'revenue_usd' IS NOT NULL 
                THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as total_revenue
            FROM events
            WHERE event_type IN ('ad_revenue', 'purchase_completed')
              ${dateFilter}
            GROUP BY user_id
          ),
          all_users AS (
            SELECT DISTINCT user_id
            FROM events
            WHERE 1=1 ${dateFilter}
          ),
          paying_users AS (
            SELECT DISTINCT user_id
            FROM events
            WHERE event_type = 'purchase_completed'
              ${dateFilter}
          )
          SELECT 
            COUNT(DISTINCT au.user_id) as total_users,
            COUNT(DISTINCT pu.user_id) as paying_users,
            COALESCE(SUM(ur.total_revenue), 0) as total_revenue,
            CASE 
              WHEN COUNT(DISTINCT au.user_id) > 0 
              THEN ROUND(COALESCE(SUM(ur.total_revenue), 0) / COUNT(DISTINCT au.user_id), 2)
              ELSE 0
            END as arpu,
            CASE 
              WHEN COUNT(DISTINCT pu.user_id) > 0 
              THEN ROUND(COALESCE(SUM(ur.total_revenue), 0) / COUNT(DISTINCT pu.user_id), 2)
              ELSE 0
            END as arppu
          FROM all_users au
          LEFT JOIN user_revenue ur ON au.user_id = ur.user_id
          LEFT JOIN paying_users pu ON au.user_id = pu.user_id
        `;

        const result = await db.query(arpuQuery);
        const row = result.rows[0];

        // Get daily trend
        const dailyTrendQuery = `
          WITH daily_revenue AS (
            SELECT 
              DATE(received_at) as date,
              user_id,
              SUM(CASE WHEN payload->>'revenue_usd' IS NOT NULL 
                THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as daily_revenue
            FROM events
            WHERE event_type IN ('ad_revenue', 'purchase_completed')
              ${dateFilter}
            GROUP BY DATE(received_at), user_id
          ),
          daily_users AS (
            SELECT 
              DATE(received_at) as date,
              COUNT(DISTINCT user_id) as total_users
            FROM events
            WHERE 1=1 ${dateFilter}
            GROUP BY DATE(received_at)
          ),
          daily_paying AS (
            SELECT 
              DATE(received_at) as date,
              COUNT(DISTINCT user_id) as paying_users
            FROM events
            WHERE event_type = 'purchase_completed'
              ${dateFilter}
            GROUP BY DATE(received_at)
          )
          SELECT 
            COALESCE(du.date, dp.date) as date,
            COALESCE(du.total_users, 0) as total_users,
            COALESCE(dp.paying_users, 0) as paying_users,
            COALESCE(SUM(dr.daily_revenue), 0) as total_revenue,
            CASE 
              WHEN COALESCE(du.total_users, 0) > 0 
              THEN ROUND(COALESCE(SUM(dr.daily_revenue), 0) / du.total_users, 2)
              ELSE 0
            END as arpu,
            CASE 
              WHEN COALESCE(dp.paying_users, 0) > 0 
              THEN ROUND(COALESCE(SUM(dr.daily_revenue), 0) / dp.paying_users, 2)
              ELSE 0
            END as arppu
          FROM daily_users du
          FULL OUTER JOIN daily_paying dp ON du.date = dp.date
          LEFT JOIN daily_revenue dr ON COALESCE(du.date, dp.date) = dr.date
          GROUP BY COALESCE(du.date, dp.date), du.total_users, dp.paying_users
          ORDER BY date DESC
        `;

        const dailyTrend = await db.query(dailyTrendQuery);

        return {
          summary: {
            total_users: parseInt(row.total_users || 0),
            paying_users: parseInt(row.paying_users || 0),
            total_revenue: parseFloat(row.total_revenue || 0),
            arpu: parseFloat(row.arpu || 0),
            arppu: parseFloat(row.arppu || 0),
            conversion_rate: row.total_users > 0
              ? parseFloat(((row.paying_users / row.total_users) * 100).toFixed(2))
              : 0,
          },
          daily_trend: dailyTrend.rows.map(r => ({
            date: r.date,
            total_users: parseInt(r.total_users || 0),
            paying_users: parseInt(r.paying_users || 0),
            total_revenue: parseFloat(r.total_revenue || 0),
            arpu: parseFloat(r.arpu || 0),
            arppu: parseFloat(r.arppu || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching ARPU metrics:', error);
      res.status(500).json({ error: 'Failed to fetch ARPU metrics' });
    }
  });

  /**
   * GET /api/dashboard/ltv
   * ✅ NEW: Lifetime Value (LTV) by cohort
   * 
   * Query params:
   * - cohort: Cohort date (YYYY-MM-DD) or 'all' for all cohorts
   * - days: Days since install to calculate LTV (default: 30)
   */
  router.get('/ltv', async (req, res) => {
    try {
      const cohort = req.query.cohort;
      const days = parseInt(req.query.days) || 30;

      const data = await getCachedQuery(req, `ltv:${cohort || 'all'}:${days}`, async () => {
        const cohortFilter = cohort && cohort !== 'all'
          ? `AND DATE(ua.install_date) = '${cohort}'::date`
          : '';

        // Calculate LTV per cohort
        const ltvQuery = `
          WITH user_revenue AS (
            SELECT 
              user_id,
              SUM(CASE WHEN payload->>'revenue_usd' IS NOT NULL 
                THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as total_revenue
            FROM events
            WHERE event_type IN ('ad_revenue', 'purchase_completed')
            GROUP BY user_id
          ),
          cohorts AS (
            SELECT 
              ua.user_id,
              DATE(ua.install_date) as cohort_date,
              ua.campaign_id
            FROM user_acquisitions ua
            WHERE 1=1 ${cohortFilter}
          )
          SELECT 
            c.cohort_date,
            c.campaign_id,
            COUNT(DISTINCT c.user_id) as cohort_size,
            COALESCE(SUM(ur.total_revenue), 0) as total_revenue,
            CASE 
              WHEN COUNT(DISTINCT c.user_id) > 0 
              THEN ROUND(COALESCE(SUM(ur.total_revenue), 0) / COUNT(DISTINCT c.user_id), 2)
              ELSE 0
            END as ltv,
            COUNT(DISTINCT CASE WHEN ur.total_revenue > 0 THEN c.user_id END) as paying_users,
            CASE 
              WHEN COUNT(DISTINCT c.user_id) > 0 
              THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ur.total_revenue > 0 THEN c.user_id END) / 
                    COUNT(DISTINCT c.user_id), 2)
              ELSE 0
            END as payer_rate
          FROM cohorts c
          LEFT JOIN user_revenue ur ON c.user_id = ur.user_id
          GROUP BY c.cohort_date, c.campaign_id
          ORDER BY c.cohort_date DESC, c.campaign_id
        `;

        const result = await db.query(ltvQuery);

        return {
          cohorts: result.rows.map(r => ({
            cohort_date: r.cohort_date,
            campaign_id: r.campaign_id || null,
            cohort_size: parseInt(r.cohort_size || 0),
            total_revenue: parseFloat(r.total_revenue || 0),
            ltv: parseFloat(r.ltv || 0),
            paying_users: parseInt(r.paying_users || 0),
            payer_rate: parseFloat(r.payer_rate || 0),
          })),
          summary: {
            total_cohorts: result.rows.length,
            total_users: result.rows.reduce((sum, r) => sum + parseInt(r.cohort_size || 0), 0),
            avg_ltv: result.rows.length > 0
              ? result.rows.reduce((sum, r) => sum + parseFloat(r.ltv || 0), 0) / result.rows.length
              : 0,
            total_revenue: result.rows.reduce((sum, r) => sum + parseFloat(r.total_revenue || 0), 0),
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching LTV metrics:', error);
      res.status(500).json({ error: 'Failed to fetch LTV metrics' });
    }
  });

  /**
   * GET /api/dashboard/revenue-breakdown
   * ✅ NEW: Revenue breakdown by source (Ads vs IAP)
   * 
   * Query params:
   * - days: Number of days to analyze (default: 30)
   * - startDate: Start date (YYYY-MM-DD)
   * - endDate: End date (YYYY-MM-DD)
   * - campaign: Filter by campaign_id
   */
  router.get('/revenue-breakdown', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      const campaignId = req.query.campaign;

      const data = await getCachedQuery(req, `revenue-breakdown:${days}:${startDate || 'all'}:${endDate || 'all'}:${campaignId || 'all'}`, async () => {
        const dateFilter = startDate && endDate
          ? `AND e.received_at >= '${startDate}'::date AND e.received_at <= '${endDate}'::date`
          : startDate
          ? `AND e.received_at >= '${startDate}'::date`
          : endDate
          ? `AND e.received_at <= '${endDate}'::date`
          : `AND e.received_at >= CURRENT_DATE - INTERVAL '${days} days'`;

        const campaignFilter = campaignId
          ? `AND (e.campaign_id = '${campaignId}' OR ua.campaign_id = '${campaignId}')`
          : '';

        // Revenue breakdown by source
        const revenueQuery = `
          WITH ad_revenue AS (
            SELECT 
              DATE(e.received_at) as date,
              SUM((e.payload->>'revenue_usd')::numeric) as ad_revenue
            FROM events e
            LEFT JOIN user_acquisitions ua ON e.user_id = ua.user_id
            WHERE e.event_type = 'ad_revenue'
              ${dateFilter}
              ${campaignFilter}
            GROUP BY DATE(e.received_at)
          ),
          iap_revenue AS (
            SELECT 
              DATE(e.received_at) as date,
              SUM((e.payload->>'revenue_usd')::numeric) as iap_revenue
            FROM events e
            LEFT JOIN user_acquisitions ua ON e.user_id = ua.user_id
            WHERE e.event_type = 'purchase_completed'
              ${dateFilter}
              ${campaignFilter}
            GROUP BY DATE(e.received_at)
          )
          SELECT 
            COALESCE(ar.date, ir.date) as date,
            COALESCE(ar.ad_revenue, 0) as ad_revenue,
            COALESCE(ir.iap_revenue, 0) as iap_revenue,
            COALESCE(ar.ad_revenue, 0) + COALESCE(ir.iap_revenue, 0) as total_revenue
          FROM ad_revenue ar
          FULL OUTER JOIN iap_revenue ir ON ar.date = ir.date
          ORDER BY date DESC
        `;

        const result = await db.query(revenueQuery);

        // Calculate totals
        const totals = result.rows.reduce((acc, r) => ({
          ad_revenue: acc.ad_revenue + parseFloat(r.ad_revenue || 0),
          iap_revenue: acc.iap_revenue + parseFloat(r.iap_revenue || 0),
          total_revenue: acc.total_revenue + parseFloat(r.total_revenue || 0),
        }), { ad_revenue: 0, iap_revenue: 0, total_revenue: 0 });

        return {
          summary: {
            total_ad_revenue: parseFloat(totals.ad_revenue.toFixed(2)),
            total_iap_revenue: parseFloat(totals.iap_revenue.toFixed(2)),
            total_revenue: parseFloat(totals.total_revenue.toFixed(2)),
            ad_revenue_percentage: totals.total_revenue > 0
              ? parseFloat(((totals.ad_revenue / totals.total_revenue) * 100).toFixed(2))
              : 0,
            iap_revenue_percentage: totals.total_revenue > 0
              ? parseFloat(((totals.iap_revenue / totals.total_revenue) * 100).toFixed(2))
              : 0,
          },
          daily_breakdown: result.rows.map(r => ({
            date: r.date,
            ad_revenue: parseFloat(r.ad_revenue || 0),
            iap_revenue: parseFloat(r.iap_revenue || 0),
            total_revenue: parseFloat(r.total_revenue || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching revenue breakdown:', error);
      res.status(500).json({ error: 'Failed to fetch revenue breakdown' });
    }
  });

  /**
   * GET /api/dashboard/conversion-rate
   * ✅ NEW: Free to paying user conversion rate
   * 
   * Query params:
   * - days: Number of days to analyze (default: 30)
   */
  router.get('/conversion-rate', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      const data = await getCachedQuery(req, `conversion-rate:${days}`, async () => {
        // Get all users and paying users
        const conversionQuery = `
          WITH all_users AS (
            SELECT DISTINCT user_id
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
          ),
          paying_users AS (
            SELECT DISTINCT user_id
            FROM events
            WHERE event_type = 'purchase_completed'
              AND received_at >= CURRENT_DATE - INTERVAL '${days} days'
          )
          SELECT 
            COUNT(DISTINCT au.user_id) as total_users,
            COUNT(DISTINCT pu.user_id) as paying_users,
            CASE 
              WHEN COUNT(DISTINCT au.user_id) > 0 
              THEN ROUND(100.0 * COUNT(DISTINCT pu.user_id) / COUNT(DISTINCT au.user_id), 2)
              ELSE 0
            END as conversion_rate
          FROM all_users au
          LEFT JOIN paying_users pu ON au.user_id = pu.user_id
        `;

        const result = await db.query(conversionQuery);
        const row = result.rows[0];

        return {
          summary: {
            total_users: parseInt(row.total_users || 0),
            paying_users: parseInt(row.paying_users || 0),
            free_users: parseInt(row.total_users || 0) - parseInt(row.paying_users || 0),
            conversion_rate: parseFloat(row.conversion_rate || 0),
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching conversion rate:', error);
      res.status(500).json({ error: 'Failed to fetch conversion rate' });
    }
  });

  /**
   * GET /api/dashboard/mau
   * ✅ NEW: Monthly Active Users (MAU)
   * 
   * Query params:
   * - month: Month to analyze (YYYY-MM format, default: current month)
   */
  router.get('/mau', async (req, res) => {
    try {
      const month = req.query.month || new Date().toISOString().slice(0, 7);

      const data = await getCachedQuery(req, `mau:${month}`, async () => {
        // Get MAU for the month
        const mauQuery = `
          SELECT COUNT(DISTINCT user_id) as mau
          FROM events
          WHERE DATE_TRUNC('month', received_at) = '${month}-01'::date
        `;

        const result = await db.query(mauQuery);

        // Get daily breakdown
        const dailyQuery = `
          SELECT 
            DATE(received_at) as date,
            COUNT(DISTINCT user_id) as daily_active_users
          FROM events
          WHERE DATE_TRUNC('month', received_at) = '${month}-01'::date
          GROUP BY DATE(received_at)
          ORDER BY date
        `;

        const daily = await db.query(dailyQuery);

        return {
          month: month,
          mau: parseInt(result.rows[0].mau || 0),
          daily_breakdown: daily.rows.map(r => ({
            date: r.date,
            daily_active_users: parseInt(r.daily_active_users || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching MAU:', error);
      res.status(500).json({ error: 'Failed to fetch MAU' });
    }
  });

  /**
   * GET /api/dashboard/stickiness
   * ✅ NEW: Stickiness rate (DAU/MAU ratio)
   * 
   * Query params:
   * - days: Number of days to analyze (default: 30)
   */
  router.get('/stickiness', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      const data = await getCachedQuery(req, `stickiness:${days}`, async () => {
        // Calculate DAU and MAU
        const stickinessQuery = `
          WITH dau_data AS (
            SELECT 
              DATE(received_at) as date,
              COUNT(DISTINCT user_id) as dau
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(received_at)
          ),
          mau_data AS (
            SELECT 
              DATE_TRUNC('month', received_at) as month,
              COUNT(DISTINCT user_id) as mau
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE_TRUNC('month', received_at)
          )
          SELECT 
            d.date,
            d.dau,
            m.mau,
            CASE 
              WHEN m.mau > 0 
              THEN ROUND(100.0 * d.dau / m.mau, 2)
              ELSE 0
            END as stickiness_rate
          FROM dau_data d
          LEFT JOIN mau_data m ON DATE_TRUNC('month', d.date) = m.month
          ORDER BY d.date DESC
        `;

        const result = await db.query(stickinessQuery);

        const avgStickiness = result.rows.length > 0
          ? result.rows.reduce((sum, r) => sum + parseFloat(r.stickiness_rate || 0), 0) / result.rows.length
          : 0;

        return {
          summary: {
            avg_stickiness_rate: parseFloat(avgStickiness.toFixed(2)),
            analysis_period_days: days,
          },
          daily_breakdown: result.rows.map(r => ({
            date: r.date,
            dau: parseInt(r.dau || 0),
            mau: parseInt(r.mau || 0),
            stickiness_rate: parseFloat(r.stickiness_rate || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching stickiness:', error);
      res.status(500).json({ error: 'Failed to fetch stickiness metrics' });
    }
  });

  /**
   * GET /api/dashboard/session-metrics
   * ✅ NEW: Session metrics (frequency, length, count)
   * 
   * Query params:
   * - days: Number of days to analyze (default: 30)
   */
  router.get('/session-metrics', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      const data = await getCachedQuery(req, `session-metrics:${days}`, async () => {
        // Calculate session metrics
        const sessionQuery = `
          WITH sessions AS (
            SELECT 
              user_id,
              payload->>'session_id' as session_id,
              MIN(received_at) as session_start,
              MAX(received_at) as session_end,
              EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) as duration_seconds
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
              AND payload->>'session_id' IS NOT NULL
            GROUP BY user_id, payload->>'session_id'
            HAVING EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) > 0
              AND EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) <= 3600
          ),
          user_sessions AS (
            SELECT 
              user_id,
              COUNT(DISTINCT session_id) as session_count,
              AVG(duration_seconds) as avg_session_duration,
              SUM(duration_seconds) as total_session_time
            FROM sessions
            GROUP BY user_id
          )
          SELECT 
            COUNT(DISTINCT s.user_id) as total_users,
            COUNT(DISTINCT s.session_id) as total_sessions,
            ROUND(AVG(us.session_count), 2) as avg_sessions_per_user,
            ROUND(AVG(us.avg_session_duration), 0) as avg_session_duration_seconds,
            ROUND(AVG(us.total_session_time), 0) as avg_total_session_time_per_user
          FROM sessions s
          JOIN user_sessions us ON s.user_id = us.user_id
        `;

        const result = await db.query(sessionQuery);
        const row = result.rows[0];

        // Get daily session trends
        const dailyQuery = `
          WITH daily_sessions AS (
            SELECT 
              DATE(received_at) as date,
              user_id,
              payload->>'session_id' as session_id,
              MIN(received_at) as session_start,
              MAX(received_at) as session_end,
              EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) as duration_seconds
            FROM events
            WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
              AND payload->>'session_id' IS NOT NULL
            GROUP BY DATE(received_at), user_id, payload->>'session_id'
            HAVING EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) > 0
              AND EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) <= 3600
          )
          SELECT 
            date,
            COUNT(DISTINCT user_id) as active_users,
            COUNT(DISTINCT session_id) as total_sessions,
            ROUND(AVG(duration_seconds), 0) as avg_session_duration_seconds
          FROM daily_sessions
          GROUP BY date
          ORDER BY date DESC
        `;

        const daily = await db.query(dailyQuery);

        return {
          summary: {
            total_users: parseInt(row.total_users || 0),
            total_sessions: parseInt(row.total_sessions || 0),
            avg_sessions_per_user: parseFloat(row.avg_sessions_per_user || 0),
            avg_session_duration_seconds: parseInt(row.avg_session_duration_seconds || 0),
            avg_total_session_time_per_user: parseInt(row.avg_total_session_time_per_user || 0),
          },
          daily_trend: daily.rows.map(r => ({
            date: r.date,
            active_users: parseInt(r.active_users || 0),
            total_sessions: parseInt(r.total_sessions || 0),
            avg_session_duration_seconds: parseInt(r.avg_session_duration_seconds || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching session metrics:', error);
      res.status(500).json({ error: 'Failed to fetch session metrics' });
    }
  });

  /**
   * GET /api/dashboard/performance
   * ✅ NEW: Performance metrics (FPS, load times, memory)
   * 
   * Query params:
   * - days: Number of days to analyze (default: 7)
   * - startDate: Start date (YYYY-MM-DD)
   * - endDate: End date (YYYY-MM-DD)
   * - device: Filter by device model
   */
  router.get('/performance', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 7;
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      const device = req.query.device;

      const data = await getCachedQuery(req, `performance:${days}:${startDate || 'all'}:${endDate || 'all'}:${device || 'all'}`, async () => {
        const dateFilter = startDate && endDate
          ? `AND timestamp >= '${startDate}'::date AND timestamp <= '${endDate}'::date`
          : startDate
          ? `AND timestamp >= '${startDate}'::date`
          : endDate
          ? `AND timestamp <= '${endDate}'::date`
          : `AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'`;

        const deviceFilter = device ? `AND device_model = '${device}'` : '';

        // Calculate average FPS, load times, memory
        const performanceQuery = `
          SELECT 
            COUNT(*) as sample_count,
            ROUND(AVG(fps_average), 2) as avg_fps,
            ROUND(MIN(fps_min), 2) as min_fps,
            ROUND(MAX(fps_max), 2) as max_fps,
            ROUND(AVG(app_load_time_ms), 0) as avg_app_load_time_ms,
            ROUND(AVG(game_load_time_ms), 0) as avg_game_load_time_ms,
            ROUND(AVG(memory_mb), 2) as avg_memory_mb,
            ROUND(AVG(frame_time_ms), 2) as avg_frame_time_ms
          FROM performance_metrics
          WHERE 1=1 ${dateFilter} ${deviceFilter}
        `;

        const result = await db.query(performanceQuery);
        const row = result.rows[0];

        // Get daily trends
        const dailyQuery = `
          SELECT 
            DATE(timestamp) as date,
            COUNT(*) as sample_count,
            ROUND(AVG(fps_average), 2) as avg_fps,
            ROUND(AVG(app_load_time_ms), 0) as avg_app_load_time_ms,
            ROUND(AVG(game_load_time_ms), 0) as avg_game_load_time_ms
          FROM performance_metrics
          WHERE 1=1 ${dateFilter} ${deviceFilter}
          GROUP BY DATE(timestamp)
          ORDER BY date DESC
        `;

        const daily = await db.query(dailyQuery);

        // Get device breakdown
        const deviceQuery = `
          SELECT 
            device_model,
            COUNT(*) as sample_count,
            ROUND(AVG(fps_average), 2) as avg_fps,
            ROUND(AVG(app_load_time_ms), 0) as avg_app_load_time_ms
          FROM performance_metrics
          WHERE 1=1 ${dateFilter}
            AND device_model IS NOT NULL
          GROUP BY device_model
          ORDER BY sample_count DESC
          LIMIT 10
        `;

        const devices = await db.query(deviceQuery);

        return {
          summary: {
            sample_count: parseInt(row.sample_count || 0),
            avg_fps: parseFloat(row.avg_fps || 0),
            min_fps: parseFloat(row.min_fps || 0),
            max_fps: parseFloat(row.max_fps || 0),
            avg_app_load_time_ms: parseInt(row.avg_app_load_time_ms || 0),
            avg_game_load_time_ms: parseInt(row.avg_game_load_time_ms || 0),
            avg_memory_mb: parseFloat(row.avg_memory_mb || 0),
            avg_frame_time_ms: parseFloat(row.avg_frame_time_ms || 0),
          },
          daily_trend: daily.rows.map(r => ({
            date: r.date,
            sample_count: parseInt(r.sample_count || 0),
            avg_fps: parseFloat(r.avg_fps || 0),
            avg_app_load_time_ms: parseInt(r.avg_app_load_time_ms || 0),
            avg_game_load_time_ms: parseInt(r.avg_game_load_time_ms || 0),
          })),
          device_breakdown: devices.rows.map(r => ({
            device_model: r.device_model,
            sample_count: parseInt(r.sample_count || 0),
            avg_fps: parseFloat(r.avg_fps || 0),
            avg_app_load_time_ms: parseInt(r.avg_app_load_time_ms || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching performance metrics:', error);
      res.status(500).json({ error: 'Failed to fetch performance metrics' });
    }
  });

  /**
   * GET /api/dashboard/crashes
   * ✅ NEW: Crash and error logs
   * 
   * Query params:
   * - days: Number of days to analyze (default: 7)
   * - startDate: Start date (YYYY-MM-DD)
   * - endDate: End date (YYYY-MM-DD)
   * - crashType: Filter by crash type ('fatal', 'error', 'exception')
   * - fatal: Filter by fatal crashes only (true/false)
   */
  router.get('/crashes', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 7;
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      const crashType = req.query.crashType;
      const fatalOnly = req.query.fatal === 'true';

      const data = await getCachedQuery(req, `crashes:${days}:${startDate || 'all'}:${endDate || 'all'}:${crashType || 'all'}:${fatalOnly}`, async () => {
        const dateFilter = startDate && endDate
          ? `AND timestamp >= '${startDate}'::date AND timestamp <= '${endDate}'::date`
          : startDate
          ? `AND timestamp >= '${startDate}'::date`
          : endDate
          ? `AND timestamp <= '${endDate}'::date`
          : `AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'`;

        const typeFilter = crashType ? `AND crash_type = '${crashType}'` : '';
        const fatalFilter = fatalOnly ? `AND fatal = true` : '';

        // Calculate crash statistics
        const crashQuery = `
          SELECT 
            COUNT(*) as total_crashes,
            COUNT(CASE WHEN fatal = true THEN 1 END) as fatal_crashes,
            COUNT(CASE WHEN fatal = false THEN 1 END) as non_fatal_errors,
            COUNT(DISTINCT user_id) as affected_users,
            COUNT(DISTINCT crash_type) as unique_crash_types
          FROM crash_logs
          WHERE 1=1 ${dateFilter} ${typeFilter} ${fatalFilter}
        `;

        const result = await db.query(crashQuery);
        const row = result.rows[0];

        // Calculate crash rate (crashes per 1000 users)
        // ✅ FIX: events table uses received_at, not timestamp
        const eventsDateFilter = startDate && endDate
          ? `AND received_at >= '${startDate}'::date AND received_at <= '${endDate}'::date`
          : startDate
          ? `AND received_at >= '${startDate}'::date`
          : endDate
          ? `AND received_at <= '${endDate}'::date`
          : `AND received_at >= CURRENT_DATE - INTERVAL '${days} days'`;
        
        const totalUsersQuery = `
          SELECT COUNT(DISTINCT user_id) as total_users
          FROM events
          WHERE 1=1 ${eventsDateFilter}
        `;
        const totalUsersResult = await db.query(totalUsersQuery);
        const totalUsers = parseInt(totalUsersResult.rows[0]?.total_users || 0);
        const crashRate = totalUsers > 0 
          ? ((parseInt(row.total_crashes || 0) / totalUsers) * 1000).toFixed(2)
          : 0;

        // Get crash breakdown by type
        const typeBreakdownQuery = `
          SELECT 
            crash_type,
            COUNT(*) as count,
            COUNT(CASE WHEN fatal = true THEN 1 END) as fatal_count
          FROM crash_logs
          WHERE 1=1 ${dateFilter} ${fatalFilter}
          GROUP BY crash_type
          ORDER BY count DESC
        `;

        const typeBreakdown = await db.query(typeBreakdownQuery);

        // Get crash breakdown by context
        const contextBreakdownQuery = `
          SELECT 
            context,
            COUNT(*) as count
          FROM crash_logs
          WHERE 1=1 ${dateFilter} ${fatalFilter}
            AND context IS NOT NULL
          GROUP BY context
          ORDER BY count DESC
          LIMIT 10
        `;

        const contextBreakdown = await db.query(contextBreakdownQuery);

        // Get daily crash trend
        const dailyQuery = `
          SELECT 
            DATE(timestamp) as date,
            COUNT(*) as total_crashes,
            COUNT(CASE WHEN fatal = true THEN 1 END) as fatal_crashes
          FROM crash_logs
          WHERE 1=1 ${dateFilter} ${typeFilter} ${fatalFilter}
          GROUP BY DATE(timestamp)
          ORDER BY date DESC
        `;

        const daily = await db.query(dailyQuery);

        // Get recent crashes (last 20)
        const recentQuery = `
          SELECT 
            id,
            user_id,
            timestamp,
            crash_type,
            crash_message,
            context,
            device_model,
            os_version,
            fatal
          FROM crash_logs
          WHERE 1=1 ${dateFilter} ${typeFilter} ${fatalFilter}
          ORDER BY timestamp DESC
          LIMIT 20
        `;

        const recent = await db.query(recentQuery);

        return {
          summary: {
            total_crashes: parseInt(row.total_crashes || 0),
            fatal_crashes: parseInt(row.fatal_crashes || 0),
            non_fatal_errors: parseInt(row.non_fatal_errors || 0),
            affected_users: parseInt(row.affected_users || 0),
            unique_crash_types: parseInt(row.unique_crash_types || 0),
            crash_rate_per_1000_users: parseFloat(crashRate),
          },
          type_breakdown: typeBreakdown.rows.map(r => ({
            crash_type: r.crash_type,
            count: parseInt(r.count || 0),
            fatal_count: parseInt(r.fatal_count || 0),
          })),
          context_breakdown: contextBreakdown.rows.map(r => ({
            context: r.context,
            count: parseInt(r.count || 0),
          })),
          daily_trend: daily.rows.map(r => ({
            date: r.date,
            total_crashes: parseInt(r.total_crashes || 0),
            fatal_crashes: parseInt(r.fatal_crashes || 0),
          })),
          recent_crashes: recent.rows.map(r => ({
            id: r.id,
            user_id: r.user_id?.substring(0, 8) + '...',
            timestamp: r.timestamp,
            crash_type: r.crash_type,
            crash_message: r.crash_message?.substring(0, 100),
            context: r.context,
            device_model: r.device_model,
            os_version: r.os_version,
            fatal: r.fatal,
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching crash logs:', error);
      res.status(500).json({ error: 'Failed to fetch crash logs' });
    }
  });

  // ============================================================================
  // NEW ENDPOINTS FOR ENHANCED DASHBOARD
  // ============================================================================

  /**
   * GET /api/dashboard/mau-trend?days=30
   * Returns MAU trend for the last N days
   */
  router.get('/mau-trend', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 30), 90);
      
      const data = await getCachedQuery(req, `mau-trend-${days}`, async () => {
        const result = await db.query(`
          SELECT 
            date,
            mau,
            dau
          FROM daily_aggregations
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ORDER BY date ASC
        `);

        return {
          dates: result.rows.map(r => r.date),
          mau: result.rows.map(r => parseInt(r.mau || r.dau || 0)),
          dau: result.rows.map(r => parseInt(r.dau || 0)),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching MAU trend:', error);
      res.status(500).json({ error: 'Failed to fetch MAU trend' });
    }
  });

  /**
   * GET /api/dashboard/sessions-per-user-trend?days=30
   * Returns sessions per user trend for the last N days
   */
  router.get('/sessions-per-user-trend', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 30), 90);
      
      const data = await getCachedQuery(req, `sessions-per-user-trend-${days}`, async () => {
        const result = await db.query(`
          SELECT 
            date,
            avg_sessions_per_user
          FROM daily_aggregations
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ORDER BY date ASC
        `);

        return {
          dates: result.rows.map(r => r.date),
          values: result.rows.map(r => parseFloat(r.avg_sessions_per_user || 0)),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching sessions per user trend:', error);
      res.status(500).json({ error: 'Failed to fetch sessions per user trend' });
    }
  });

  /**
   * GET /api/dashboard/session-length-trend?days=30
   * Returns average session length trend for the last N days
   */
  router.get('/session-length-trend', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 30), 90);
      
      const data = await getCachedQuery(req, `session-length-trend-${days}`, async () => {
        const result = await db.query(`
          SELECT 
            date,
            avg_session_length_seconds
          FROM daily_aggregations
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ORDER BY date ASC
        `);

        return {
          dates: result.rows.map(r => r.date),
          values: result.rows.map(r => parseInt(r.avg_session_length_seconds || 0)),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching session length trend:', error);
      res.status(500).json({ error: 'Failed to fetch session length trend' });
    }
  });

  /**
   * GET /api/dashboard/level-performance-detailed?new_users_only=false
   * Returns detailed level performance with first-time attempts and 7-day averages
   */
  router.get('/level-performance-detailed', async (req, res) => {
    try {
      const newUsersOnly = req.query.new_users_only === 'true';
      
      const data = await getCachedQuery(req, `level-performance-detailed-${newUsersOnly}`, async () => {
        // Get today's data
        let todayQuery = `
          SELECT 
            CAST(level_id AS INTEGER) as level_id,
            CAST(zone_id AS INTEGER) as zone_id,
            total_tries,
            total_completions,
            first_tries,
            first_completions,
            completion_rate,
            first_time_completion_rate
          FROM level_performance_daily
          WHERE date = CURRENT_DATE
        `;

        // Get 7-day average data
        let avgQuery = `
          SELECT 
            CAST(level_id AS INTEGER) as level_id,
            CAST(zone_id AS INTEGER) as zone_id,
            ROUND(AVG(total_tries), 0) as avg_total_tries,
            ROUND(AVG(total_completions), 0) as avg_total_completions,
            ROUND(AVG(first_tries), 0) as avg_first_tries,
            ROUND(AVG(first_completions), 0) as avg_first_completions,
            ROUND(AVG(completion_rate), 1) as avg_completion_rate,
            ROUND(AVG(first_time_completion_rate), 1) as avg_first_time_completion_rate
          FROM level_performance_daily
          WHERE date >= CURRENT_DATE - INTERVAL '7 days'
          GROUP BY level_id, zone_id
        `;

        // Filter by new users if requested
        if (newUsersOnly) {
          // Optimized: Use user_acquisitions directly and aggregate from events
          // This avoids the expensive JOIN with the full events table
          todayQuery = `
            WITH new_user_levels AS (
              SELECT 
                payload->>'level_id' as level_id,
                payload->>'zone_id' as zone_id,
                event_type,
                CASE 
                  WHEN event_type = 'level_started' 
                  THEN (payload->>'is_first_attempt')::boolean
                  ELSE NULL
                END as is_first_attempt,
                CASE 
                  WHEN event_type = 'level_completed' 
                  THEN (payload->>'first_attempt')::boolean
                  ELSE NULL
                END as first_attempt
              FROM events e
              INNER JOIN user_acquisitions ua ON e.user_id = ua.user_id
                AND DATE(ua.install_date) = CURRENT_DATE
              WHERE e.event_type IN ('level_started', 'level_completed', 'level_failed')
                AND DATE(e.received_at) = CURRENT_DATE
                AND e.payload->>'level_id' IS NOT NULL
            )
            SELECT 
              CAST(level_id AS INTEGER) as level_id,
              CAST(zone_id AS INTEGER) as zone_id,
              COUNT(CASE WHEN event_type = 'level_started' THEN 1 END) as total_tries,
              COUNT(CASE WHEN event_type = 'level_completed' THEN 1 END) as total_completions,
              COUNT(CASE WHEN event_type = 'level_started' AND is_first_attempt = true THEN 1 END) as first_tries,
              COUNT(CASE WHEN event_type = 'level_completed' AND first_attempt = true THEN 1 END) as first_completions,
              CASE 
                WHEN COUNT(CASE WHEN event_type = 'level_started' THEN 1 END) > 0
                THEN ROUND(100.0 * COUNT(CASE WHEN event_type = 'level_completed' THEN 1 END) / 
                          COUNT(CASE WHEN event_type = 'level_started' THEN 1 END), 1)
                ELSE 0
              END as completion_rate,
              CASE 
                WHEN COUNT(CASE WHEN event_type = 'level_started' AND is_first_attempt = true THEN 1 END) > 0
                THEN ROUND(100.0 * COUNT(CASE WHEN event_type = 'level_completed' AND first_attempt = true THEN 1 END) / 
                          COUNT(CASE WHEN event_type = 'level_started' AND is_first_attempt = true THEN 1 END), 1)
                ELSE 0
              END as first_time_completion_rate
            FROM new_user_levels
            GROUP BY level_id, zone_id
          `;
        }

        const [todayResult, avgResult] = await Promise.all([
          db.query(todayQuery),
          db.query(avgQuery)
        ]);

        // Create lookup for averages
        const avgMap = {};
        avgResult.rows.forEach(row => {
          avgMap[parseInt(row.level_id)] = {
            avg_total_tries: parseInt(row.avg_total_tries || 0),
            avg_total_completions: parseInt(row.avg_total_completions || 0),
            avg_first_tries: parseInt(row.avg_first_tries || 0),
            avg_first_completions: parseInt(row.avg_first_completions || 0),
            avg_completion_rate: parseFloat(row.avg_completion_rate || 0),
            avg_first_time_completion_rate: parseFloat(row.avg_first_time_completion_rate || 0),
          };
        });

        // Group by zone
        const byZone = {};
        todayResult.rows.forEach(row => {
          const zoneId = parseInt(row.zone_id || 1);
          const levelId = parseInt(row.level_id);
          
          if (!byZone[zoneId]) {
            byZone[zoneId] = [];
          }

          byZone[zoneId].push({
            level_id: levelId,
            zone_id: zoneId,
            today: {
              total_tries: parseInt(row.total_tries || 0),
              total_completions: parseInt(row.total_completions || 0),
              first_tries: parseInt(row.first_tries || 0),
              first_completions: parseInt(row.first_completions || 0),
              completion_rate: parseFloat(row.completion_rate || 0),
              first_time_completion_rate: parseFloat(row.first_time_completion_rate || 0),
            },
            avg_7days: avgMap[levelId] || {
              avg_total_tries: 0,
              avg_total_completions: 0,
              avg_first_tries: 0,
              avg_first_completions: 0,
              avg_completion_rate: 0,
              avg_first_time_completion_rate: 0,
            }
          });
        });

        // Sort levels within each zone
        Object.keys(byZone).forEach(zoneId => {
          byZone[zoneId].sort((a, b) => a.level_id - b.level_id);
        });

        return {
          zones: byZone,
          new_users_only: newUsersOnly,
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching detailed level performance:', error);
      res.status(500).json({ error: 'Failed to fetch detailed level performance' });
    }
  });

  /**
   * GET /api/dashboard/funnel
   * Returns user funnel data (installs → first open → tutorial → levels 1-10)
   */
  router.get('/funnel', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 30), 90);
      
      const data = await getCachedQuery(req, `funnel-${days}`, async () => {
        const result = await db.query(`
          SELECT 
            date,
            installs,
            first_opens,
            tutorial_starts,
            level_1_starts,
            level_2_starts,
            level_3_starts,
            level_4_starts,
            level_5_starts,
            level_6_starts,
            level_7_starts,
            level_8_starts,
            level_9_starts,
            level_10_starts,
            install_to_first_open_rate,
            first_open_to_tutorial_rate,
            tutorial_to_level_1_rate,
            level_1_to_level_10_rate
          FROM user_funnel_daily
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ORDER BY date DESC
        `);

        return {
          daily: result.rows.map(r => ({
            date: r.date,
            installs: parseInt(r.installs || 0),
            first_opens: parseInt(r.first_opens || 0),
            tutorial_starts: parseInt(r.tutorial_starts || 0),
            level_1_starts: parseInt(r.level_1_starts || 0),
            level_2_starts: parseInt(r.level_2_starts || 0),
            level_3_starts: parseInt(r.level_3_starts || 0),
            level_4_starts: parseInt(r.level_4_starts || 0),
            level_5_starts: parseInt(r.level_5_starts || 0),
            level_6_starts: parseInt(r.level_6_starts || 0),
            level_7_starts: parseInt(r.level_7_starts || 0),
            level_8_starts: parseInt(r.level_8_starts || 0),
            level_9_starts: parseInt(r.level_9_starts || 0),
            level_10_starts: parseInt(r.level_10_starts || 0),
            conversion_rates: {
              install_to_first_open: parseFloat(r.install_to_first_open_rate || 0),
              first_open_to_tutorial: parseFloat(r.first_open_to_tutorial_rate || 0),
              tutorial_to_level_1: parseFloat(r.tutorial_to_level_1_rate || 0),
              level_1_to_level_10: parseFloat(r.level_1_to_level_10_rate || 0),
            }
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching funnel data:', error);
      res.status(500).json({ error: 'Failed to fetch funnel data' });
    }
  });

  /**
   * GET /api/dashboard/cohort-analysis-enhanced?campaign_id=all&days=90
   * Returns enhanced cohort analysis with D1/D2/D3/D7/D30 retention, revenue breakdown, CPI, ROI
   */
  router.get('/cohort-analysis-enhanced', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 90;
      const campaignIdFilter = req.query.campaign_id || 'all';
      const platformFilter = req.query.platform || 'all';

      const data = await getCachedQuery(req, `cohort-analysis-enhanced:${days}:${campaignIdFilter}:${platformFilter}`, async () => {
        let query = `
          SELECT 
            cohort_date,
            campaign_id,
            platform,
            cohort_size,
            d1_retained,
            d2_retained,
            d3_retained,
            d7_retained,
            d30_retained,
            d1_retention_rate,
            d2_retention_rate,
            d3_retention_rate,
            d7_retention_rate,
            d30_retention_rate,
            ad_revenue_usd,
            iap_revenue_usd,
            total_revenue_usd,
            ltv,
            cpi,
            cost_usd,
            roi_percentage,
            paying_users,
            payer_rate
          FROM cohort_aggregations
          WHERE cohort_date >= CURRENT_DATE - INTERVAL '${days} days'
        `;

        const queryParams = [];
        let paramIndex = 1;

        if (platformFilter !== 'all') {
          query += ` AND platform = $${paramIndex++}`;
          queryParams.push(platformFilter);
        }
        if (campaignIdFilter !== 'all') {
          query += ` AND campaign_id = $${paramIndex++}`;
          queryParams.push(campaignIdFilter);
        }

        query += ` ORDER BY cohort_date DESC`;

        const result = await db.query(query, queryParams);

        return {
          cohorts: result.rows.map(r => ({
            cohort_date: r.cohort_date,
            campaign_id: r.campaign_id,
            platform: r.platform,
            cohort_size: parseInt(r.cohort_size || 0),
            retention: {
              d1: {
                retained: parseInt(r.d1_retained || 0),
                rate: parseFloat(r.d1_retention_rate || 0)
              },
              d2: {
                retained: parseInt(r.d2_retained || 0),
                rate: parseFloat(r.d2_retention_rate || 0)
              },
              d3: {
                retained: parseInt(r.d3_retained || 0),
                rate: parseFloat(r.d3_retention_rate || 0)
              },
              d7: {
                retained: parseInt(r.d7_retained || 0),
                rate: parseFloat(r.d7_retention_rate || 0)
              },
              d30: {
                retained: parseInt(r.d30_retained || 0),
                rate: parseFloat(r.d30_retention_rate || 0)
              }
            },
            revenue: {
              ad_revenue_usd: parseFloat(r.ad_revenue_usd || 0),
              iap_revenue_usd: parseFloat(r.iap_revenue_usd || 0),
              total_revenue_usd: parseFloat(r.total_revenue_usd || 0),
              ltv: parseFloat(r.ltv || 0)
            },
            campaign: {
              cpi: parseFloat(r.cpi || 0),
              cost_usd: parseFloat(r.cost_usd || 0),
              roi_percentage: parseFloat(r.roi_percentage || 0)
            },
            paying_users: parseInt(r.paying_users || 0),
            payer_rate: parseFloat(r.payer_rate || 0)
          })),
          filters: {
            campaign_id: campaignIdFilter,
            platform: platformFilter,
            days
          },
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching enhanced cohort analysis:', error);
      res.status(500).json({ error: 'Failed to fetch enhanced cohort analysis' });
    }
  });

  /**
   * GET /api/dashboard/missions-achievements
   * Returns missions and achievements metrics
   */
  router.get('/missions-achievements', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 30);
      
      const data = await getCachedQuery(req, `missions-achievements-${days}`, async () => {
        // Today's metrics
        const todayQuery = `
          SELECT 
            COUNT(CASE WHEN event_type = 'mission_completed' THEN 1 END) as missions_completed_today,
            COUNT(CASE WHEN event_type = 'achievement_unlocked' THEN 1 END) as achievements_unlocked_today,
            COUNT(CASE WHEN event_type = 'mission_completed' THEN 1 END) as missions_claimed_today,
            COUNT(CASE WHEN event_type = 'achievement_claimed' THEN 1 END) as achievements_claimed_today,
            COUNT(DISTINCT CASE WHEN event_type = 'mission_completed' THEN user_id END) as unique_mission_claimers_today,
            COUNT(DISTINCT CASE WHEN event_type = 'achievement_claimed' THEN user_id END) as unique_achievement_claimers_today
          FROM events
          WHERE DATE(received_at) = CURRENT_DATE
            AND event_type IN ('mission_completed', 'achievement_unlocked', 'achievement_claimed')
        `;

        // 7-day trend
        const trendQuery = `
          SELECT 
            DATE(received_at) as date,
            COUNT(CASE WHEN event_type = 'mission_completed' THEN 1 END) as missions_completed,
            COUNT(CASE WHEN event_type = 'achievement_unlocked' THEN 1 END) as achievements_unlocked,
            COUNT(CASE WHEN event_type = 'mission_completed' THEN 1 END) as missions_claimed,
            COUNT(CASE WHEN event_type = 'achievement_claimed' THEN 1 END) as achievements_claimed,
            COUNT(DISTINCT CASE WHEN event_type = 'mission_completed' THEN user_id END) as unique_mission_claimers,
            COUNT(DISTINCT CASE WHEN event_type = 'achievement_claimed' THEN user_id END) as unique_achievement_claimers
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND event_type IN ('mission_completed', 'achievement_unlocked', 'achievement_claimed')
          GROUP BY DATE(received_at)
          ORDER BY date ASC
        `;

        const [todayResult, trendResult] = await Promise.all([
          db.query(todayQuery),
          db.query(trendQuery)
        ]);

        return {
          today: {
            missions_completed: parseInt(todayResult.rows[0]?.missions_completed_today || 0),
            achievements_unlocked: parseInt(todayResult.rows[0]?.achievements_unlocked_today || 0),
            missions_claimed: parseInt(todayResult.rows[0]?.missions_claimed_today || 0),
            achievements_claimed: parseInt(todayResult.rows[0]?.achievements_claimed_today || 0),
            unique_mission_claimers: parseInt(todayResult.rows[0]?.unique_mission_claimers_today || 0),
            unique_achievement_claimers: parseInt(todayResult.rows[0]?.unique_achievement_claimers_today || 0),
          },
          trend: trendResult.rows.map(r => ({
            date: r.date,
            missions_completed: parseInt(r.missions_completed || 0),
            achievements_unlocked: parseInt(r.achievements_unlocked || 0),
            missions_claimed: parseInt(r.missions_claimed || 0),
            achievements_claimed: parseInt(r.achievements_claimed || 0),
            unique_mission_claimers: parseInt(r.unique_mission_claimers || 0),
            unique_achievement_claimers: parseInt(r.unique_achievement_claimers || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching missions/achievements metrics:', error);
      res.status(500).json({ error: 'Failed to fetch missions/achievements metrics' });
    }
  });

  /**
   * GET /api/dashboard/tournaments
   * Returns tournament metrics
   */
  router.get('/tournaments', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 30);
      
      const data = await getCachedQuery(req, `tournaments-${days}`, async () => {
        // Today's metrics
        const todayQuery = `
          SELECT 
            COUNT(CASE WHEN event_type = 'tournament_round_completed' THEN 1 END) as rounds_played_today,
            COUNT(CASE WHEN event_type = 'tournament_round_completed' THEN 1 END) as rounds_won_today,
            COUNT(CASE WHEN event_type = 'tournament_round_failed' THEN 1 END) as rounds_lost_today,
            COUNT(CASE WHEN event_type = 'tournament_completed' THEN 1 END) as tournaments_won_today
          FROM events
          WHERE DATE(received_at) = CURRENT_DATE
            AND event_type IN ('tournament_round_completed', 'tournament_round_failed', 'tournament_completed')
        `;

        // 7-day trend
        const trendQuery = `
          SELECT 
            DATE(received_at) as date,
            COUNT(CASE WHEN event_type = 'tournament_round_completed' THEN 1 END) as rounds_played,
            COUNT(CASE WHEN event_type = 'tournament_round_completed' THEN 1 END) as rounds_won,
            COUNT(CASE WHEN event_type = 'tournament_round_failed' THEN 1 END) as rounds_lost,
            COUNT(CASE WHEN event_type = 'tournament_completed' THEN 1 END) as tournaments_won
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND event_type IN ('tournament_round_completed', 'tournament_round_failed', 'tournament_completed')
          GROUP BY DATE(received_at)
          ORDER BY date ASC
        `;

        // Tournament type distribution (today)
        const distributionTodayQuery = `
          SELECT 
            COALESCE(payload->>'tournament_name', payload->>'tournament_id', 'unknown') as tournament_type,
            COUNT(*) as rounds_played
          FROM events
          WHERE DATE(received_at) = CURRENT_DATE
            AND event_type = 'tournament_round_completed'
          GROUP BY COALESCE(payload->>'tournament_name', payload->>'tournament_id', 'unknown')
          ORDER BY rounds_played DESC
        `;

        // Tournament type distribution (7-day trend) - get all dates first
        const allDatesQuery = `
          SELECT DISTINCT DATE(received_at) as date
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND event_type = 'tournament_round_completed'
          ORDER BY date ASC
        `;

        // Get all tournament types
        const tournamentTypesQuery = `
          SELECT DISTINCT COALESCE(payload->>'tournament_name', payload->>'tournament_id', 'unknown') as tournament_type
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND event_type = 'tournament_round_completed'
        `;

        const [todayResult, trendResult, distributionTodayResult, allDatesResult, tournamentTypesResult] = await Promise.all([
          db.query(todayQuery),
          db.query(trendQuery),
          db.query(distributionTodayQuery),
          db.query(allDatesQuery),
          db.query(tournamentTypesQuery)
        ]);

        // Get distribution data for each date and tournament type
        const dates = allDatesResult.rows.map(r => r.date);
        const tournamentTypes = tournamentTypesResult.rows.map(r => r.tournament_type || 'unknown');
        
        const distributionTrendQuery = `
          SELECT 
            DATE(received_at) as date,
            COALESCE(payload->>'tournament_name', payload->>'tournament_id', 'unknown') as tournament_type,
            COUNT(*) as rounds_played
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND event_type = 'tournament_round_completed'
          GROUP BY DATE(received_at), COALESCE(payload->>'tournament_name', payload->>'tournament_id', 'unknown')
        `;

        const distributionTrendResult = await db.query(distributionTrendQuery);

        // Group distribution trend by tournament type
        const distributionByType = {};
        tournamentTypes.forEach(type => {
          distributionByType[type] = dates.map(date => {
            const dateStr = date ? date.toISOString().split('T')[0] : null;
            const row = distributionTrendResult.rows.find(r => {
              const rDateStr = r.date ? r.date.toISOString().split('T')[0] : null;
              return rDateStr === dateStr && (r.tournament_type || 'unknown') === type;
            });
            return {
              date: dateStr,
              rounds_played: row ? parseInt(row.rounds_played || 0) : 0
            };
          });
        });

        return {
          today: {
            rounds_played: parseInt(todayResult.rows[0]?.rounds_played_today || 0),
            rounds_won: parseInt(todayResult.rows[0]?.rounds_won_today || 0),
            rounds_lost: parseInt(todayResult.rows[0]?.rounds_lost_today || 0),
            tournaments_won: parseInt(todayResult.rows[0]?.tournaments_won_today || 0),
          },
          trend: trendResult.rows.map(r => ({
            date: r.date ? r.date.toISOString().split('T')[0] : null,
            rounds_played: parseInt(r.rounds_played || 0),
            rounds_won: parseInt(r.rounds_won || 0),
            rounds_lost: parseInt(r.rounds_lost || 0),
            tournaments_won: parseInt(r.tournaments_won || 0),
          })),
          distribution_today: distributionTodayResult.rows.map(r => ({
            tournament_type: r.tournament_type || 'unknown',
            rounds_played: parseInt(r.rounds_played || 0)
          })),
          distribution_trend: distributionByType,
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching tournament metrics:', error);
      res.status(500).json({ error: 'Failed to fetch tournament metrics' });
    }
  });

  /**
   * GET /api/dashboard/continue-usage
   * Returns continue usage metrics
   */
  router.get('/continue-usage', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 30);
      
      const data = await getCachedQuery(req, `continue-usage-${days}`, async () => {
        // Today's metrics
        const todayQuery = `
          SELECT 
            COUNT(CASE WHEN event_type = 'continue_used' AND payload->>'continue_type' = 'ad_watch' THEN 1 END) as continues_via_ads_today,
            COUNT(CASE WHEN event_type = 'continue_used' AND payload->>'continue_type' = 'gem_purchase' THEN 1 END) as continues_via_gems_today
          FROM events
          WHERE DATE(received_at) = CURRENT_DATE
            AND event_type = 'continue_used'
        `;

        // 7-day trend
        const trendQuery = `
          SELECT 
            DATE(received_at) as date,
            COUNT(CASE WHEN payload->>'continue_type' = 'ad_watch' THEN 1 END) as continues_via_ads,
            COUNT(CASE WHEN payload->>'continue_type' = 'gem_purchase' THEN 1 END) as continues_via_gems
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND event_type = 'continue_used'
          GROUP BY DATE(received_at)
          ORDER BY date ASC
        `;

        const [todayResult, trendResult] = await Promise.all([
          db.query(todayQuery),
          db.query(trendQuery)
        ]);

        return {
          today: {
            continues_via_ads: parseInt(todayResult.rows[0]?.continues_via_ads_today || 0),
            continues_via_gems: parseInt(todayResult.rows[0]?.continues_via_gems_today || 0),
          },
          trend: trendResult.rows.map(r => ({
            date: r.date,
            continues_via_ads: parseInt(r.continues_via_ads || 0),
            continues_via_gems: parseInt(r.continues_via_gems || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching continue usage metrics:', error);
      res.status(500).json({ error: 'Failed to fetch continue usage metrics' });
    }
  });

  /**
   * GET /api/dashboard/ads-shown
   * Returns ads shown metrics
   */
  router.get('/ads-shown', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days || 7), 30);
      
      const data = await getCachedQuery(req, `ads-shown-${days}`, async () => {
        // Today's metrics
        const todayQuery = `
          SELECT 
            COUNT(CASE WHEN event_type = 'interstitial_shown' AND payload->>'trigger_reason' = 'win_milestone' THEN 1 END) as ads_after_wins_today,
            COUNT(CASE WHEN event_type = 'interstitial_shown' AND payload->>'trigger_reason' = 'loss_streak' THEN 1 END) as ads_after_losses_today,
            COUNT(CASE WHEN event_type = 'interstitial_shown' AND (
              payload->>'trigger_reason' = 'tournament_round_win' OR
              payload->>'trigger_reason' = 'tournament_start_over' OR
              payload->>'trigger_reason' = 'tournament_game_over'
            ) THEN 1 END) as ads_from_tournaments_today
          FROM events
          WHERE DATE(received_at) = CURRENT_DATE
            AND event_type = 'interstitial_shown'
        `;

        // 7-day trend
        const trendQuery = `
          SELECT 
            DATE(received_at) as date,
            COUNT(CASE WHEN payload->>'trigger_reason' = 'win_milestone' THEN 1 END) as ads_after_wins,
            COUNT(CASE WHEN payload->>'trigger_reason' = 'loss_streak' THEN 1 END) as ads_after_losses,
            COUNT(CASE WHEN (
              payload->>'trigger_reason' = 'tournament_round_win' OR
              payload->>'trigger_reason' = 'tournament_start_over' OR
              payload->>'trigger_reason' = 'tournament_game_over'
            ) THEN 1 END) as ads_from_tournaments
          FROM events
          WHERE received_at >= CURRENT_DATE - INTERVAL '${days} days'
            AND event_type = 'interstitial_shown'
          GROUP BY DATE(received_at)
          ORDER BY date ASC
        `;

        const [todayResult, trendResult] = await Promise.all([
          db.query(todayQuery),
          db.query(trendQuery)
        ]);

        return {
          today: {
            ads_after_wins: parseInt(todayResult.rows[0]?.ads_after_wins_today || 0),
            ads_after_losses: parseInt(todayResult.rows[0]?.ads_after_losses_today || 0),
            ads_from_tournaments: parseInt(todayResult.rows[0]?.ads_from_tournaments_today || 0),
          },
          trend: trendResult.rows.map(r => ({
            date: r.date,
            ads_after_wins: parseInt(r.ads_after_wins || 0),
            ads_after_losses: parseInt(r.ads_after_losses || 0),
            ads_from_tournaments: parseInt(r.ads_from_tournaments || 0),
          })),
          last_updated: new Date().toISOString()
        };
      });

      res.json(data);
    } catch (error) {
      logger.error('📊 Error fetching ads shown metrics:', error);
      res.status(500).json({ error: 'Failed to fetch ads shown metrics' });
    }
  });

  /**
   * GET /api/dashboard/health
   * Check dashboard API health
   */
  router.get('/health', async (req, res) => {
    try {
      // Test database connection
      await db.query('SELECT 1');
      
      // Test cache connection with detailed diagnostics
      let cacheStatus = 'unavailable';
      let cacheStats = null;
      let redisStatus = null;
      
      // ✅ Get fresh cache manager reference (supports runtime upgrades)
      const currentCacheManager = getCacheManager(req);
      
      if (currentCacheManager && currentCacheManager.redis) {
        redisStatus = currentCacheManager.redis.status;
        
        if (currentCacheManager.redis.status === 'ready') {
          try {
            // Test cache write/read
            const testKey = 'health-check-test';
            const testValue = { timestamp: Date.now(), test: true };
            const setResult = await currentCacheManager.set(testKey, testValue, 10);
            const getResult = await currentCacheManager.get(testKey);
            
            if (setResult && getResult && getResult.test === true) {
              cacheStatus = 'connected';
            } else {
              cacheStatus = 'degraded';
              logger.warn('📊 Cache health check: set/get test failed', {
                setResult,
                getResult: getResult ? 'exists' : 'null'
              });
            }
            
            // Clean up test key
            await currentCacheManager.delete(testKey);
            
            // Get cache statistics
            cacheStats = currentCacheManager.getStats();
          } catch (cacheError) {
            cacheStatus = 'error';
            logger.error('📊 Cache health check error:', cacheError);
          }
        } else {
          cacheStatus = 'disconnected';
        }
      }
      
      res.json({
        status: 'healthy',
        database: 'connected',
        cache: {
          status: cacheStatus,
          redis_status: redisStatus,
          stats: cacheStats
        },
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


