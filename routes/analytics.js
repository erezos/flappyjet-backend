// 📊 Analytics Routes - Comprehensive User Analytics API
// Handles all user analytics tracking and reporting

const express = require('express');
  const router = express.Router();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// POST /api/analytics/event - Submit analytics event
router.post('/event', async (req, res) => {
  try {
    const { event_name, event_data } = req.body;
    
    // Allow anonymous analytics events for some events
    const anonymousEvents = ['app_start', 'app_crash', 'performance_metrics'];
    const isAnonymous = anonymousEvents.includes(event_name);
    
    let playerId = null;
    if (!isAnonymous) {
      // Try to get player ID from token
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
          playerId = decoded.playerId;
        } catch (err) {
          // Token invalid, but continue with anonymous event
          console.log('Invalid token for analytics event, continuing anonymously');
        }
      }
    }

    // Determine event category based on event name
    const eventCategory = getEventCategory(event_name);

      // Insert analytics event
    const query = `
      INSERT INTO analytics_events (player_id, event_name, event_category, parameters, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `;
    
    const values = [
      playerId,
      event_name,
      eventCategory,
      event_data || {}
    ];

    const result = await pool.query(query, values);

    // If this is a user analytics sync event, update the user_analytics table
    if (event_name === 'user_analytics_sync' && playerId && event_data) {
      await updateUserAnalytics(playerId, event_data);
    }

      res.json({
        success: true,
      event_id: result.rows[0].id,
      message: 'Analytics event recorded'
      });

    } catch (error) {
    console.error('Analytics event error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record analytics event'
    });
  }
});

// POST /api/analytics/batch - Submit multiple analytics events (Smart Analytics)
router.post('/batch', async (req, res) => {
  try {
    const { events } = req.body;
    
    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Events array required'
      });
    }

    // Limit batch size to prevent abuse
    if (events.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Batch size too large (max 100 events)'
      });
    }

    const insertedEvents = [];
    const errors = [];

    // Process events in batches for better performance
    const batchSize = 20;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      
      try {
        // Prepare batch insert
        const values = [];
        const placeholders = [];
        
        batch.forEach((event, index) => {
          const baseIndex = i + index;
          const { event_name, event_data, timestamp, session_id, player_id } = event;
          
          // Allow anonymous analytics events for some events
          const anonymousEvents = ['app_start', 'app_crash', 'performance_metrics', 'app_launch'];
          const isAnonymous = anonymousEvents.includes(event_name);
          
          let finalPlayerId = player_id;
          if (!isAnonymous && !finalPlayerId) {
            // Try to get player ID from token
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            
            if (token) {
              try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
                finalPlayerId = decoded.playerId;
              } catch (err) {
                // Token invalid, but continue with anonymous event
                console.log('Invalid token for analytics batch, continuing anonymously');
              }
            }
          }

          const eventTimestamp = timestamp ? new Date(timestamp) : new Date();
          const eventCategory = getEventCategory(event_name);
          
          values.push(
            finalPlayerId,
            event_name,
            eventCategory,
            event_data || {},
            eventTimestamp,
            session_id || null
          );
          
          placeholders.push(`($${baseIndex * 6 + 1}, $${baseIndex * 6 + 2}, $${baseIndex * 6 + 3}, $${baseIndex * 6 + 4}, $${baseIndex * 6 + 5}, $${baseIndex * 6 + 6})`);
        });

        const query = `
          INSERT INTO analytics_events (player_id, event_name, event_category, parameters, created_at, session_id)
          VALUES ${placeholders.join(', ')}
          RETURNING id, event_name
        `;

        const result = await pool.query(query, values);
        insertedEvents.push(...result.rows);

      } catch (batchError) {
        console.error('Batch insert error:', batchError);
        errors.push({
          batch_index: i,
          error: batchError.message,
          events_count: batch.length
        });
      }
    }

    // Handle special events that need additional processing
    for (const event of events) {
      if (event.event_name === 'user_analytics_sync' && event.player_id && event.event_data) {
        try {
          await updateUserAnalytics(event.player_id, event.event_data);
        } catch (error) {
          console.error('User analytics sync error:', error);
        }
      }
    }

    res.json({
      success: true,
      inserted_count: insertedEvents.length,
      total_events: events.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Processed ${insertedEvents.length}/${events.length} events`
    });

  } catch (error) {
    console.error('Analytics batch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process analytics batch'
    });
  }
});

// POST /api/analytics/user-sync - Sync comprehensive user analytics
router.post('/user-sync', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;
    const analyticsData = req.body;

    await updateUserAnalytics(playerId, analyticsData);

      res.json({
        success: true,
      message: 'User analytics synced successfully'
      });

    } catch (error) {
    console.error('User analytics sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync user analytics'
    });
  }
});

// GET /api/analytics/user - Get user analytics data
router.get('/user', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;

    const query = `
      SELECT * FROM user_analytics 
      WHERE player_id = $1
    `;

    const result = await pool.query(query, [playerId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        analytics: null,
        message: 'No analytics data found'
      });
    }

    res.json({
      success: true,
      analytics: result.rows[0]
      });

    } catch (error) {
    console.error('Get user analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user analytics'
    });
  }
});

// GET /api/analytics/summary - Get analytics summary (admin only)
router.get('/summary', async (req, res) => {
  try {
    // Basic analytics summary (no auth required for now, but should be restricted in production)
    const queries = {
      totalUsers: 'SELECT COUNT(*) as count FROM user_analytics',
      activeToday: `
        SELECT COUNT(*) as count FROM user_analytics 
        WHERE last_session_date >= CURRENT_DATE
      `,
      totalRevenue: 'SELECT SUM(total_spent_usd) as total FROM user_analytics',
      totalGames: 'SELECT SUM(number_of_games) as total FROM user_analytics',
      averageSession: 'SELECT AVG(number_of_sessions) as avg FROM user_analytics',
      topCountries: `
        SELECT country_code, COUNT(*) as users 
        FROM user_analytics 
        GROUP BY country_code 
        ORDER BY users DESC 
        LIMIT 10
      `,
      platformDistribution: `
        SELECT platform, COUNT(*) as users 
        FROM user_analytics 
        GROUP BY platform
      `
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
      const result = await pool.query(query);
      results[key] = result.rows;
    }

      res.json({
        success: true,
      summary: results
      });

    } catch (error) {
    console.error('Analytics summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics summary'
    });
  }
});

// GET /api/analytics/cohorts - Get cohort analysis
router.get('/cohorts', async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    
    let groupBy;
    switch (period) {
      case 'month':
        groupBy = 'install_month';
        break;
      case 'quarter':
        groupBy = 'install_quarter';
        break;
      default:
        groupBy = 'install_week';
    }

    const query = `
        SELECT 
        ${groupBy} as cohort_period,
        COUNT(*) as cohort_size,
        AVG(ltv_day_1) as avg_ltv_day_1,
        AVG(ltv_day_7) as avg_ltv_day_7,
        AVG(ltv_day_30) as avg_ltv_day_30,
        AVG(ltv_day_90) as avg_ltv_day_90,
        AVG(CASE WHEN retention_day_1 THEN 1.0 ELSE 0.0 END) as retention_day_1,
        AVG(CASE WHEN retention_day_7 THEN 1.0 ELSE 0.0 END) as retention_day_7,
        AVG(CASE WHEN retention_day_30 THEN 1.0 ELSE 0.0 END) as retention_day_30,
        AVG(CASE WHEN retention_day_90 THEN 1.0 ELSE 0.0 END) as retention_day_90
      FROM user_cohorts
      WHERE ${groupBy} >= CURRENT_DATE - INTERVAL '1 year'
      GROUP BY ${groupBy}
      ORDER BY ${groupBy} DESC
      LIMIT 52
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      cohorts: result.rows,
      period: period
    });

  } catch (error) {
    console.error('Cohort analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cohort analysis'
    });
  }
});

// GET /api/analytics/segments - Get user segments
router.get('/segments', async (req, res) => {
  try {
    const query = `
        SELECT 
        spending_segment,
        engagement_segment,
        skill_segment,
        COUNT(*) as user_count,
        AVG(total_spent_usd) as avg_spending,
        AVG(number_of_sessions) as avg_sessions,
        AVG(high_score) as avg_high_score
      FROM user_segments
      GROUP BY spending_segment, engagement_segment, skill_segment
      ORDER BY user_count DESC
    `;

    const result = await pool.query(query);

      res.json({
        success: true,
      segments: result.rows
    });

  } catch (error) {
    console.error('User segments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user segments'
    });
  }
});

// POST /api/analytics/refresh-views - Refresh materialized views
router.post('/refresh-views', async (req, res) => {
  try {
    await pool.query('SELECT refresh_analytics_views()');

    res.json({
      success: true,
      message: 'Analytics views refreshed successfully'
      });

    } catch (error) {
    console.error('Refresh views error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh analytics views'
    });
  }
});

// Helper function to determine event category
function getEventCategory(eventName) {
  const categoryMap = {
    // Gameplay events
    'game_start': 'gameplay',
    'game_end': 'gameplay',
    'level_up': 'gameplay',
    'mission_complete': 'gameplay',
    'achievement_unlock': 'gameplay',
    'tournament_event': 'gameplay',
    'user_engagement': 'gameplay',
    
    // Monetization events
    'purchase': 'monetization',
    'iap_purchase': 'monetization',
    'ad_event': 'monetization',
    'rewarded_ad_reward_granted': 'monetization',
    'rewarded_ad_reward_failed': 'monetization',
    
    // Retention events
    'app_start': 'retention',
    'app_launch': 'retention',
    'session_start': 'retention',
    'session_end': 'retention',
    'social_share': 'retention',
    'app_rating': 'retention',
    'feature_usage': 'retention',
    
    // System events
    'app_crash': 'system',
    'performance_metric': 'system',
    'app_error': 'system',
    'user_analytics_sync': 'system',
  };
  
  return categoryMap[eventName] || 'other';
}

// Helper function to update user analytics
async function updateUserAnalytics(playerId, analyticsData) {
  const query = `
    INSERT INTO user_analytics (
      player_id, install_date, number_of_sessions, total_play_time_seconds,
      last_session_date, session_streak, number_of_games, best_streak,
      high_score, total_score, average_score, daily_missions_completed,
      achievements_completed, total_achievement_points, number_of_purchases,
      total_spent_usd, number_of_continues_used, total_gems_spent,
      total_coins_spent, jets_owned, owned_jet_ids, current_jet_id,
      skins_owned, device_model, os_version, platform, country_code,
      timezone, app_version, ad_watch_count, share_count,
      rate_us_prompt_shown, has_rated_app, crash_count, last_crash_date,
      feature_usage, level_completion_times, tutorial_completed,
      preferred_play_times, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
      $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, NOW()
    )
    ON CONFLICT (player_id) DO UPDATE SET
      number_of_sessions = EXCLUDED.number_of_sessions,
      total_play_time_seconds = EXCLUDED.total_play_time_seconds,
      last_session_date = EXCLUDED.last_session_date,
      session_streak = EXCLUDED.session_streak,
      number_of_games = EXCLUDED.number_of_games,
      best_streak = EXCLUDED.best_streak,
      high_score = EXCLUDED.high_score,
      total_score = EXCLUDED.total_score,
      average_score = EXCLUDED.average_score,
      daily_missions_completed = EXCLUDED.daily_missions_completed,
      achievements_completed = EXCLUDED.achievements_completed,
      total_achievement_points = EXCLUDED.total_achievement_points,
      number_of_purchases = EXCLUDED.number_of_purchases,
      total_spent_usd = EXCLUDED.total_spent_usd,
      number_of_continues_used = EXCLUDED.number_of_continues_used,
      total_gems_spent = EXCLUDED.total_gems_spent,
      total_coins_spent = EXCLUDED.total_coins_spent,
      jets_owned = EXCLUDED.jets_owned,
      owned_jet_ids = EXCLUDED.owned_jet_ids,
      current_jet_id = EXCLUDED.current_jet_id,
      skins_owned = EXCLUDED.skins_owned,
      device_model = EXCLUDED.device_model,
      os_version = EXCLUDED.os_version,
      platform = EXCLUDED.platform,
      country_code = EXCLUDED.country_code,
      timezone = EXCLUDED.timezone,
      app_version = EXCLUDED.app_version,
      ad_watch_count = EXCLUDED.ad_watch_count,
      share_count = EXCLUDED.share_count,
      rate_us_prompt_shown = EXCLUDED.rate_us_prompt_shown,
      has_rated_app = EXCLUDED.has_rated_app,
      crash_count = EXCLUDED.crash_count,
      last_crash_date = EXCLUDED.last_crash_date,
      feature_usage = EXCLUDED.feature_usage,
      level_completion_times = EXCLUDED.level_completion_times,
      tutorial_completed = EXCLUDED.tutorial_completed,
      preferred_play_times = EXCLUDED.preferred_play_times,
      updated_at = NOW()
  `;

  const values = [
    playerId,
    new Date(analyticsData.installDate || Date.now()),
    analyticsData.numberOfSessions || 0,
    analyticsData.totalPlayTimeSeconds || 0,
    new Date(analyticsData.lastSessionDate || Date.now()),
    analyticsData.sessionStreak || 0,
    analyticsData.numberOfGames || 0,
    analyticsData.bestStreak || 0,
    analyticsData.highScore || 0,
    analyticsData.totalScore || 0,
    analyticsData.averageScore || 0,
    analyticsData.dailyMissionsCompleted || 0,
    analyticsData.achievementsCompleted || 0,
    analyticsData.totalAchievementPoints || 0,
    analyticsData.numberOfPurchases || 0,
    analyticsData.totalSpentUSD || 0,
    analyticsData.numberOfContinuesUsed || 0,
    analyticsData.totalGemsSpent || 0,
    analyticsData.totalCoinsSpent || 0,
    analyticsData.jetsOwned || 1,
    analyticsData.ownedJetIds || ['sky_jet'],
    analyticsData.currentJetId || 'sky_jet',
    analyticsData.skinsOwned || 1,
    analyticsData.deviceModel || 'unknown',
    analyticsData.osVersion || 'unknown',
    analyticsData.platform || 'unknown',
    analyticsData.countryCode || 'US',
    analyticsData.timezone || 'UTC',
    analyticsData.appVersion || '1.0.0',
    analyticsData.adWatchCount || 0,
    analyticsData.shareCount || 0,
    analyticsData.rateUsPromptShown || 0,
    analyticsData.hasRatedApp || false,
    analyticsData.crashCount || 0,
    analyticsData.lastCrashDate ? new Date(analyticsData.lastCrashDate) : new Date(0),
    JSON.stringify(analyticsData.featureUsage || {}),
    JSON.stringify(analyticsData.levelCompletionTimes || {}),
    analyticsData.tutorialCompleted || 0,
    analyticsData.preferredPlayTimes || []
  ];

  await pool.query(query, values);
}

module.exports = router;