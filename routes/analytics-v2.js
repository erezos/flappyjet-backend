// 📊 Enhanced Analytics Routes v2 - Comprehensive KPI Dashboard API
// Handles all 16 KPIs with backward compatibility for existing endpoints
// Production-ready with Railway Pro optimizations

const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Database connection with Railway Pro optimizations
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Increased connection pool for Railway Pro
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Enhanced authentication for v2 endpoints
const authenticateV2 = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Access token required',
      version: 'v2'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid token',
        version: 'v2'
      });
    }
    req.user = user;
    next();
  });
};

// Dashboard API key authentication
const authenticateDashboard = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.DASHBOARD_API_KEY || 'flappyjet-analytics-2024';
  
  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid API key required for dashboard access',
      version: 'v2'
    });
  }
  
  next();
};

// ============================================================================
// V2 ANALYTICS ENDPOINTS - Enhanced Event Tracking
// ============================================================================

/**
 * POST /api/analytics/v2/event - Enhanced single event tracking
 */
router.post('/v2/event', async (req, res) => {
  try {
    const { 
      event_name, 
      event_data, 
      session_id,
      timestamp,
      user_type,
      player_id 
    } = req.body;
    
    // Enhanced validation
    if (!event_name) {
      return res.status(400).json({
        success: false,
        error: 'Event name is required',
        version: 'v2'
      });
    }

    // Determine event category and priority
    const eventCategory = getEventCategoryV2(event_name);
    const eventPriority = getEventPriority(event_name);
    
    // Enhanced event data enrichment
    const enrichedData = {
      ...event_data,
      session_id: session_id || null,
      user_type: user_type || 'unknown',
      player_id: player_id || null,
      timestamp: timestamp || Date.now(),
      app_version: req.headers['x-app-version'] || '1.5.5',
      platform: req.headers['user-agent']?.includes('Android') ? 'android' : 'ios',
      ip_address: req.ip,
    };

    // Insert with enhanced schema
    const query = `
      INSERT INTO analytics_events_v2 (
        player_id, event_name, event_category, event_priority,
        parameters, session_id, user_type, platform, 
        app_version, ip_address, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING id, event_name
    `;
    
    const values = [
      enrichedData.player_id,
      event_name,
      eventCategory,
      eventPriority,
      enrichedData,
      enrichedData.session_id,
      enrichedData.user_type,
      enrichedData.platform,
      enrichedData.app_version,
      enrichedData.ip_address
    ];

    const result = await pool.query(query, values);

    // Handle special events that need additional processing
    await handleSpecialEventV2(event_name, enrichedData);

    res.json({
      success: true,
      event_id: result.rows[0].id,
      event_name: result.rows[0].event_name,
      version: 'v2',
      message: 'Enhanced analytics event recorded'
    });

  } catch (error) {
    console.error('V2 Analytics event error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record analytics event',
      version: 'v2',
      message: error.message
    });
  }
});

/**
 * POST /api/analytics/v2/batch - Enhanced batch event processing
 */
router.post('/v2/batch', async (req, res) => {
  try {
    const { events } = req.body;
    
    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Events array required',
        version: 'v2'
      });
    }

    // Enhanced batch size limits
    if (events.length > 200) {
      return res.status(400).json({
        success: false,
        error: 'Batch size too large (max 200 events)',
        version: 'v2'
      });
    }

    const insertedEvents = [];
    const errors = [];

    // Process events in optimized batches
    const batchSize = 50; // Increased batch size for Railway Pro
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      
      try {
        const values = [];
        const placeholders = [];
        
        batch.forEach((event, index) => {
          const baseIndex = i + index;
          const { 
            event_name, 
            event_data, 
            session_id, 
            timestamp, 
            user_type, 
            player_id 
          } = event;
          
          const eventCategory = getEventCategoryV2(event_name);
          const eventPriority = getEventPriority(event_name);
          
          const enrichedData = {
            ...event_data,
            session_id: session_id || null,
            user_type: user_type || 'unknown',
            player_id: player_id || null,
            timestamp: timestamp || Date.now(),
            app_version: req.headers['x-app-version'] || '1.5.5',
            platform: req.headers['user-agent']?.includes('Android') ? 'android' : 'ios',
            ip_address: req.ip,
          };
          
          values.push(
            enrichedData.player_id,
            event_name,
            eventCategory,
            eventPriority,
            enrichedData,
            enrichedData.session_id,
            enrichedData.user_type,
            enrichedData.platform,
            enrichedData.app_version,
            enrichedData.ip_address,
            new Date(enrichedData.timestamp)
          );
          
          placeholders.push(`($${baseIndex * 11 + 1}, $${baseIndex * 11 + 2}, $${baseIndex * 11 + 3}, $${baseIndex * 11 + 4}, $${baseIndex * 11 + 5}, $${baseIndex * 11 + 6}, $${baseIndex * 11 + 7}, $${baseIndex * 11 + 8}, $${baseIndex * 11 + 9}, $${baseIndex * 11 + 10}, $${baseIndex * 11 + 11})`);
        });

        const query = `
          INSERT INTO analytics_events_v2 (
            player_id, event_name, event_category, event_priority,
            parameters, session_id, user_type, platform, 
            app_version, ip_address, created_at
          )
          VALUES ${placeholders.join(', ')}
          RETURNING id, event_name
        `;

        const result = await pool.query(query, values);
        insertedEvents.push(...result.rows);

      } catch (batchError) {
        console.error('V2 Batch insert error:', batchError);
        errors.push({
          batch_index: i,
          error: batchError.message,
          events_count: batch.length
        });
      }
    }

    // Handle special events
    for (const event of events) {
      try {
        await handleSpecialEventV2(event.event_name, event.event_data);
      } catch (error) {
        console.error('Special event handling error:', error);
      }
    }

    res.json({
      success: true,
      inserted_count: insertedEvents.length,
      total_events: events.length,
      errors: errors.length > 0 ? errors : undefined,
      version: 'v2',
      message: `Processed ${insertedEvents.length}/${events.length} events`
    });

  } catch (error) {
    console.error('V2 Analytics batch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process analytics batch',
      version: 'v2',
      message: error.message
    });
  }
});

// ============================================================================
// V2 DASHBOARD ENDPOINTS - All 16 KPIs
// ============================================================================

/**
 * GET /api/analytics/v2/dashboard/kpis - Comprehensive KPI Dashboard
 * Returns all 16 KPIs in a single optimized query
 */
router.get('/v2/dashboard/kpis', authenticateDashboard, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Single comprehensive query for all KPIs
    const query = `
      WITH daily_metrics AS (
        SELECT 
          DATE(created_at) as date,
          -- 1. DAU/MAU
          COUNT(DISTINCT player_id) as dau,
          COUNT(DISTINCT CASE WHEN event_name = 'session_start' THEN player_id END) as session_users,
          COUNT(DISTINCT CASE WHEN event_name = 'game_start' THEN player_id END) as gaming_users,
          
          -- 2. Games per session/day
          COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) as total_games,
          COUNT(DISTINCT session_id) as total_sessions,
          ROUND(AVG(CASE WHEN event_name = 'game_start' THEN (parameters->>'games_in_session')::int END), 2) as avg_games_per_session,
          
          -- 3. Session length
          ROUND(AVG(CASE WHEN event_name = 'session_end' THEN (parameters->>'session_duration_seconds')::int END), 2) as avg_session_duration,
          
          -- 4. Missions completed
          COUNT(CASE WHEN event_name = 'mission_complete' THEN 1 END) as missions_completed,
          COUNT(DISTINCT CASE WHEN event_name = 'mission_complete' THEN player_id END) as users_completed_missions,
          COUNT(CASE WHEN event_name = 'daily_mission_cycle_complete' AND (parameters->>'all_missions_completed')::boolean THEN 1 END) as users_all_missions,
          
          -- 5. Achievements
          COUNT(CASE WHEN event_name = 'achievement_unlock' THEN 1 END) as achievements_unlocked,
          COUNT(DISTINCT CASE WHEN event_name = 'achievement_unlock' THEN player_id END) as users_unlocked_achievements,
          
          -- 6. Continue usage
          COUNT(CASE WHEN event_name = 'continue_used' THEN 1 END) as continues_used,
          COUNT(CASE WHEN event_name = 'continue_used' AND parameters->>'continue_type' = 'ad' THEN 1 END) as continues_via_ad,
          COUNT(CASE WHEN event_name = 'continue_used' AND parameters->>'continue_type' = 'gems' THEN 1 END) as continues_via_gems,
          
          -- 7. Ad completion rate
          COUNT(CASE WHEN event_name = 'ad_shown' THEN 1 END) as ads_shown,
          COUNT(CASE WHEN event_name = 'ad_completed' THEN 1 END) as ads_completed,
          COUNT(CASE WHEN event_name = 'ad_abandoned' THEN 1 END) as ads_abandoned,
          
          -- 8. Currency tracking
          SUM(CASE WHEN event_name = 'currency_earned' AND parameters->>'currency_type' = 'coins' THEN (parameters->>'amount')::int ELSE 0 END) as coins_earned,
          SUM(CASE WHEN event_name = 'currency_earned' AND parameters->>'currency_type' = 'gems' THEN (parameters->>'amount')::int ELSE 0 END) as gems_earned,
          SUM(CASE WHEN event_name = 'currency_spent' AND parameters->>'currency_type' = 'coins' THEN (parameters->>'amount')::int ELSE 0 END) as coins_spent,
          SUM(CASE WHEN event_name = 'currency_spent' AND parameters->>'currency_type' = 'gems' THEN (parameters->>'amount')::int ELSE 0 END) as gems_spent,
          
          -- 9. Revenue
          COUNT(CASE WHEN event_name = 'iap_purchase' THEN 1 END) as purchases,
          SUM(CASE WHEN event_name = 'iap_purchase' THEN (parameters->>'price_usd')::decimal ELSE 0 END) as revenue_usd,
          COUNT(DISTINCT CASE WHEN event_name = 'iap_purchase' THEN player_id END) as paying_users
          
        FROM analytics_events_v2
        WHERE created_at >= $1
        GROUP BY DATE(created_at)
      ),
      retention_metrics AS (
        SELECT 
          DATE(created_at) as date,
          COUNT(DISTINCT player_id) as cohort_size,
          COUNT(DISTINCT CASE WHEN event_name = 'retention_event' AND parameters->>'event_type' = 'day_1' AND (parameters->>'is_retained')::boolean THEN player_id END) as day1_retained,
          COUNT(DISTINCT CASE WHEN event_name = 'retention_event' AND parameters->>'event_type' = 'day_7' AND (parameters->>'is_retained')::boolean THEN player_id END) as day7_retained,
          COUNT(DISTINCT CASE WHEN event_name = 'retention_event' AND parameters->>'event_type' = 'day_30' AND (parameters->>'is_retained')::boolean THEN player_id END) as day30_retained
        FROM analytics_events_v2
        WHERE created_at >= $1
        GROUP BY DATE(created_at)
      )
      SELECT 
        dm.date,
        -- User metrics
        dm.dau,
        dm.session_users,
        dm.gaming_users,
        
        -- Game metrics
        dm.total_games,
        dm.total_sessions,
        dm.avg_games_per_session,
        dm.avg_session_duration,
        
        -- Mission metrics
        dm.missions_completed,
        dm.users_completed_missions,
        dm.users_all_missions,
        CASE WHEN dm.users_completed_missions > 0 THEN ROUND(dm.users_all_missions::numeric / dm.users_completed_missions * 100, 2) ELSE 0 END as mission_completion_rate,
        
        -- Achievement metrics
        dm.achievements_unlocked,
        dm.users_unlocked_achievements,
        CASE WHEN dm.users_unlocked_achievements > 0 THEN ROUND(dm.achievements_unlocked::numeric / dm.users_unlocked_achievements, 2) ELSE 0 END as avg_achievements_per_user,
        
        -- Continue metrics
        dm.continues_used,
        dm.continues_via_ad,
        dm.continues_via_gems,
        CASE WHEN dm.dau > 0 THEN ROUND(dm.continues_used::numeric / dm.dau, 2) ELSE 0 END as avg_continues_per_user,
        
        -- Ad metrics
        dm.ads_shown,
        dm.ads_completed,
        dm.ads_abandoned,
        CASE WHEN dm.ads_shown > 0 THEN ROUND(dm.ads_completed::numeric / dm.ads_shown * 100, 2) ELSE 0 END as ad_completion_rate,
        
        -- Currency metrics
        dm.coins_earned,
        dm.gems_earned,
        dm.coins_spent,
        dm.gems_spent,
        
        -- Revenue metrics
        dm.purchases,
        dm.revenue_usd,
        dm.paying_users,
        CASE WHEN dm.dau > 0 THEN ROUND(dm.revenue_usd / dm.dau, 4) ELSE 0 END as arpu,
        CASE WHEN dm.paying_users > 0 THEN ROUND(dm.revenue_usd / dm.paying_users, 2) ELSE 0 END as arppu,
        
        -- Retention metrics
        rm.cohort_size,
        rm.day1_retained,
        rm.day7_retained,
        rm.day30_retained,
        CASE WHEN rm.cohort_size > 0 THEN ROUND(rm.day1_retained::numeric / rm.cohort_size * 100, 2) ELSE 0 END as day1_retention_rate,
        CASE WHEN rm.cohort_size > 0 THEN ROUND(rm.day7_retained::numeric / rm.cohort_size * 100, 2) ELSE 0 END as day7_retention_rate,
        CASE WHEN rm.cohort_size > 0 THEN ROUND(rm.day30_retained::numeric / rm.cohort_size * 100, 2) ELSE 0 END as day30_retention_rate
        
      FROM daily_metrics dm
      LEFT JOIN retention_metrics rm ON dm.date = rm.date
      ORDER BY dm.date DESC
      LIMIT $2
    `;
    
    const result = await pool.query(query, [startDate, days]);
    
    // Calculate summary statistics
    const summary = calculateKPISummary(result.rows);
    
    res.json({
      success: true,
      version: 'v2',
      data: result.rows,
      summary: summary,
      meta: {
        total_days: result.rows.length,
        date_range: {
          from: result.rows[result.rows.length - 1]?.date,
          to: result.rows[0]?.date
        },
        generated_at: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('V2 KPI Dashboard API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch KPI dashboard',
      version: 'v2',
      message: error.message 
    });
  }
});

/**
 * GET /api/analytics/v2/dashboard/retention - Detailed retention analysis
 */
router.get('/v2/dashboard/retention', authenticateDashboard, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    
    const query = `
      WITH user_cohorts AS (
        SELECT 
          player_id,
          DATE(MIN(created_at)) as install_date,
          DATE_TRUNC('week', MIN(created_at))::DATE as install_week
        FROM analytics_events_v2
        WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY player_id
      ),
      retention_events AS (
        SELECT 
          uc.player_id,
          uc.install_date,
          uc.install_week,
          DATE(ae.created_at) as activity_date,
          DATE(ae.created_at) - uc.install_date as days_since_install
        FROM user_cohorts uc
        JOIN analytics_events_v2 ae ON uc.player_id = ae.player_id
        WHERE ae.created_at >= CURRENT_DATE - INTERVAL '${days} days'
      )
      SELECT 
        install_week,
        COUNT(DISTINCT player_id) as cohort_size,
        COUNT(DISTINCT CASE WHEN days_since_install = 1 THEN player_id END) as day1_retained,
        COUNT(DISTINCT CASE WHEN days_since_install = 7 THEN player_id END) as day7_retained,
        COUNT(DISTINCT CASE WHEN days_since_install = 30 THEN player_id END) as day30_retained,
        ROUND(
          COUNT(DISTINCT CASE WHEN days_since_install = 1 THEN player_id END)::numeric / 
          COUNT(DISTINCT player_id) * 100, 2
        ) as day1_retention_rate,
        ROUND(
          COUNT(DISTINCT CASE WHEN days_since_install = 7 THEN player_id END)::numeric / 
          COUNT(DISTINCT player_id) * 100, 2
        ) as day7_retention_rate,
        ROUND(
          COUNT(DISTINCT CASE WHEN days_since_install = 30 THEN player_id END)::numeric / 
          COUNT(DISTINCT player_id) * 100, 2
        ) as day30_retention_rate
      FROM retention_events
      GROUP BY install_week
      HAVING COUNT(DISTINCT player_id) >= 5
      ORDER BY install_week DESC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      version: 'v2',
      data: result.rows,
      meta: {
        total_cohorts: result.rows.length,
        avg_retention: {
          day1: result.rows.reduce((sum, row) => sum + (row.day1_retention_rate || 0), 0) / result.rows.length || 0,
          day7: result.rows.reduce((sum, row) => sum + (row.day7_retention_rate || 0), 0) / result.rows.length || 0,
          day30: result.rows.reduce((sum, row) => sum + (row.day30_retention_rate || 0), 0) / result.rows.length || 0
        }
      }
    });
    
  } catch (error) {
    console.error('V2 Retention API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch retention data',
      version: 'v2',
      message: error.message 
    });
  }
});

/**
 * GET /api/analytics/v2/dashboard/monetization - Revenue and monetization metrics
 */
router.get('/v2/dashboard/monetization', authenticateDashboard, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    
    const query = `
      SELECT 
        DATE(created_at) as date,
        -- Revenue metrics
        COUNT(CASE WHEN event_name = 'iap_purchase' THEN 1 END) as purchases,
        SUM(CASE WHEN event_name = 'iap_purchase' THEN (parameters->>'price_usd')::decimal ELSE 0 END) as revenue_usd,
        COUNT(DISTINCT CASE WHEN event_name = 'iap_purchase' THEN player_id END) as paying_users,
        
        -- Product breakdown
        COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'gems' THEN 1 END) as gem_purchases,
        COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'hearts' THEN 1 END) as heart_purchases,
        COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'jet' THEN 1 END) as jet_purchases,
        COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'remove_ads' THEN 1 END) as remove_ads_purchases,
        
        -- Ad metrics
        COUNT(CASE WHEN event_name = 'ad_shown' THEN 1 END) as ads_shown,
        COUNT(CASE WHEN event_name = 'ad_completed' THEN 1 END) as ads_completed,
        COUNT(CASE WHEN event_name = 'ad_abandoned' THEN 1 END) as ads_abandoned,
        
        -- Continue metrics
        COUNT(CASE WHEN event_name = 'continue_used' AND parameters->>'continue_type' = 'ad' THEN 1 END) as continues_via_ad,
        COUNT(CASE WHEN event_name = 'continue_used' AND parameters->>'continue_type' = 'gems' THEN 1 END) as continues_via_gems,
        
        -- Currency metrics
        SUM(CASE WHEN event_name = 'currency_spent' AND parameters->>'currency_type' = 'coins' THEN (parameters->>'amount')::int ELSE 0 END) as coins_spent,
        SUM(CASE WHEN event_name = 'currency_spent' AND parameters->>'currency_type' = 'gems' THEN (parameters->>'amount')::int ELSE 0 END) as gems_spent,
        
        -- Calculated metrics
        CASE WHEN COUNT(DISTINCT player_id) > 0 THEN ROUND(SUM(CASE WHEN event_name = 'iap_purchase' THEN (parameters->>'price_usd')::decimal ELSE 0 END) / COUNT(DISTINCT player_id), 4) ELSE 0 END as arpu,
        CASE WHEN COUNT(DISTINCT CASE WHEN event_name = 'iap_purchase' THEN player_id END) > 0 THEN ROUND(SUM(CASE WHEN event_name = 'iap_purchase' THEN (parameters->>'price_usd')::decimal ELSE 0 END) / COUNT(DISTINCT CASE WHEN event_name = 'iap_purchase' THEN player_id END), 2) ELSE 0 END as arppu,
        CASE WHEN COUNT(CASE WHEN event_name = 'ad_shown' THEN 1 END) > 0 THEN ROUND(COUNT(CASE WHEN event_name = 'ad_completed' THEN 1 END)::numeric / COUNT(CASE WHEN event_name = 'ad_shown' THEN 1 END) * 100, 2) ELSE 0 END as ad_completion_rate
        
      FROM analytics_events_v2
      WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      version: 'v2',
      data: result.rows,
      meta: {
        total_days: result.rows.length,
        total_revenue: result.rows.reduce((sum, row) => sum + (row.revenue_usd || 0), 0),
        total_purchases: result.rows.reduce((sum, row) => sum + (row.purchases || 0), 0),
        avg_arpu: result.rows.reduce((sum, row) => sum + (row.arpu || 0), 0) / result.rows.length || 0,
        avg_ad_completion_rate: result.rows.reduce((sum, row) => sum + (row.ad_completion_rate || 0), 0) / result.rows.length || 0
      }
    });
    
  } catch (error) {
    console.error('V2 Monetization API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch monetization data',
      version: 'v2',
      message: error.message 
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getEventCategoryV2(eventName) {
  const categoryMap = {
    // User lifecycle
    'app_launch': 'lifecycle',
    'session_start': 'lifecycle',
    'session_end': 'lifecycle',
    'retention_event': 'lifecycle',
    
    // Gameplay
    'game_start': 'gameplay',
    'game_end': 'gameplay',
    'mission_complete': 'gameplay',
    'daily_mission_cycle_complete': 'gameplay',
    'achievement_unlock': 'gameplay',
    'continue_used': 'gameplay',
    
    // Monetization
    'iap_purchase': 'monetization',
    'currency_earned': 'monetization',
    'currency_spent': 'monetization',
    'ad_shown': 'monetization',
    'ad_completed': 'monetization',
    'ad_abandoned': 'monetization',
    
    // System
    'daily_summary': 'system',
    'error_occurred': 'system',
  };
  
  return categoryMap[eventName] || 'other';
}

function getEventPriority(eventName) {
  const priorityMap = {
    'iap_purchase': 'high',
    'session_start': 'high',
    'session_end': 'high',
    'game_start': 'medium',
    'game_end': 'medium',
    'mission_complete': 'medium',
    'achievement_unlock': 'medium',
    'continue_used': 'medium',
    'ad_completed': 'medium',
    'ad_abandoned': 'medium',
    'currency_earned': 'low',
    'currency_spent': 'low',
    'ad_shown': 'low',
    'daily_summary': 'low',
  };
  
  return priorityMap[eventName] || 'low';
}

async function handleSpecialEventV2(eventName, eventData) {
  switch (eventName) {
    case 'session_start':
      // Update user analytics with session data
      break;
    case 'iap_purchase':
      // Update revenue tracking
      break;
    case 'daily_summary':
      // Update daily aggregated metrics
      break;
    default:
      // No special handling needed
      break;
  }
}

function calculateKPISummary(data) {
  if (data.length === 0) return {};
  
  return {
    avg_dau: data.reduce((sum, row) => sum + (row.dau || 0), 0) / data.length,
    avg_session_duration: data.reduce((sum, row) => sum + (row.avg_session_duration || 0), 0) / data.length,
    avg_games_per_session: data.reduce((sum, row) => sum + (row.avg_games_per_session || 0), 0) / data.length,
    avg_ad_completion_rate: data.reduce((sum, row) => sum + (row.ad_completion_rate || 0), 0) / data.length,
    avg_arpu: data.reduce((sum, row) => sum + (row.arpu || 0), 0) / data.length,
    total_revenue: data.reduce((sum, row) => sum + (row.revenue_usd || 0), 0),
    total_purchases: data.reduce((sum, row) => sum + (row.purchases || 0), 0),
    total_continues: data.reduce((sum, row) => sum + (row.continues_used || 0), 0),
    total_missions_completed: data.reduce((sum, row) => sum + (row.missions_completed || 0), 0),
    total_achievements_unlocked: data.reduce((sum, row) => sum + (row.achievements_unlocked || 0), 0),
  };
}

module.exports = router;
