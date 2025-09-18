// 📊 Analytics Dashboard API Routes
// Serves KPI data to the Daily Dashboard
const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

// Database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Simple API key authentication for dashboard access
const authenticateDashboard = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.DASHBOARD_API_KEY || 'flappyjet-analytics-2024';
  
  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Valid API key required for dashboard access' 
    });
  }
  
  next();
};

// ============================================================================
// DASHBOARD DATA ENDPOINTS
// ============================================================================

/**
 * GET /api/analytics/kpi-summary
 * Returns the main KPI summary for dashboard cards
 */
router.get('/kpi-summary', authenticateDashboard, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const query = `
      SELECT 
        date,
        daily_active_users,
        gaming_users,
        monetizing_users,
        total_revenue_usd as daily_revenue,
        paying_users,
        total_purchases as daily_purchases,
        total_sessions,
        avg_sessions_per_user,
        completion_rate_percent,
        total_crashes as daily_crashes,
        crash_rate_percent,
        ad_conversion_rate,
        iap_conversion_rate,
        arpu,
        arppu
      FROM daily_kpi_summary 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY date DESC
      LIMIT ${days}
    `;
    
    const result = await db.query(query);
    
    // Add calculated metrics
    const data = result.rows.map(row => ({
      ...row,
      crash_rate_per_1000: row.daily_active_users > 0 ? 
        (row.daily_crashes / row.daily_active_users * 1000) : 0,
      revenue_per_dau: row.daily_active_users > 0 ? 
        (row.daily_revenue / row.daily_active_users) : 0
    }));
    
    res.json({
      success: true,
      data,
      meta: {
        total_days: data.length,
        date_range: {
          from: data[data.length - 1]?.date,
          to: data[0]?.date
        }
      }
    });
    
  } catch (error) {
    console.error('KPI Summary API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch KPI summary',
      message: error.message 
    });
  }
});

/**
 * GET /api/analytics/trends
 * Returns trend data for charts (DAU, Revenue over time)
 */
router.get('/trends', authenticateDashboard, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const query = `
      SELECT 
        date,
        daily_active_users,
        gaming_users,
        android_users,
        ios_users,
        daily_revenue,
        daily_purchases,
        paying_users,
        arpu,
        conversion_rate
      FROM daily_kpi_summary 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
        AND daily_active_users > 0  -- Only include days with actual activity
      ORDER BY date ASC  -- Ascending for chart display
    `;
    
    const result = await db.query(query);
    
    res.json({
      success: true,
      data: result.rows,
      meta: {
        total_days: result.rows.length,
        avg_dau: result.rows.reduce((sum, row) => sum + (row.daily_active_users || 0), 0) / result.rows.length,
        avg_revenue: result.rows.reduce((sum, row) => sum + (row.daily_revenue || 0), 0) / result.rows.length
      }
    });
    
  } catch (error) {
    console.error('Trends API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch trends data',
      message: error.message 
    });
  }
});

/**
 * GET /api/analytics/retention
 * Returns retention cohort analysis data
 */
router.get('/retention', authenticateDashboard, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const query = `
      SELECT 
        install_date,
        cohort_size,
        day1_retained,
        day1_retention_rate,
        day7_retained,
        day7_retention_rate,
        day30_retained,
        day30_retention_rate
      FROM retention_cohorts 
      WHERE install_date >= CURRENT_DATE - INTERVAL '${days} days'
        AND cohort_size >= 5  -- Only meaningful cohorts
      ORDER BY install_date ASC
    `;
    
    const result = await db.query(query);
    
    // Calculate overall averages
    const avgRetention = {
      day1: result.rows.reduce((sum, row) => sum + (row.day1_retention_rate || 0), 0) / result.rows.length || 0,
      day7: result.rows.reduce((sum, row) => sum + (row.day7_retention_rate || 0), 0) / result.rows.length || 0,
      day30: result.rows.reduce((sum, row) => sum + (row.day30_retention_rate || 0), 0) / result.rows.length || 0
    };
    
    res.json({
      success: true,
      data: result.rows,
      meta: {
        total_cohorts: result.rows.length,
        avg_retention: avgRetention,
        total_users_analyzed: result.rows.reduce((sum, row) => sum + (row.cohort_size || 0), 0)
      }
    });
    
  } catch (error) {
    console.error('Retention API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch retention data',
      message: error.message 
    });
  }
});

/**
 * GET /api/analytics/monetization
 * Returns monetization funnel and performance data
 */
router.get('/monetization', authenticateDashboard, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const query = `
      SELECT 
        dks.date,
        dks.daily_revenue,
        dks.daily_purchases,
        dks.paying_users,
        dks.arpu,
        dks.arppu,
        dks.conversion_rate,
        dmf.ads_shown,
        dmf.ads_completed,
        dmf.ad_rewards_granted,
        dmf.ad_completion_rate
      FROM daily_kpi_summary dks
      LEFT JOIN daily_monetization_funnel dmf ON dks.date = dmf.date
      WHERE dks.date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY dks.date ASC
    `;
    
    const result = await db.query(query);
    
    // Calculate funnel metrics
    const totalAdsShown = result.rows.reduce((sum, row) => sum + (row.ads_shown || 0), 0);
    const totalAdsCompleted = result.rows.reduce((sum, row) => sum + (row.ads_completed || 0), 0);
    const overallAdCompletionRate = totalAdsShown > 0 ? (totalAdsCompleted / totalAdsShown * 100) : 0;
    
    res.json({
      success: true,
      data: result.rows,
      meta: {
        total_days: result.rows.length,
        funnel_metrics: {
          total_ads_shown: totalAdsShown,
          total_ads_completed: totalAdsCompleted,
          overall_completion_rate: overallAdCompletionRate,
          total_revenue: result.rows.reduce((sum, row) => sum + (row.daily_revenue || 0), 0)
        }
      }
    });
    
  } catch (error) {
    console.error('Monetization API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch monetization data',
      message: error.message 
    });
  }
});

/**
 * GET /api/analytics/platform
 * Returns platform comparison data (iOS vs Android)
 */
router.get('/platform', authenticateDashboard, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const query = `
      SELECT 
        date,
        android_users,
        ios_users,
        daily_active_users,
        -- Calculate platform percentages
        CASE 
          WHEN daily_active_users > 0 
          THEN ROUND(android_users::numeric / daily_active_users * 100, 1)
          ELSE 0 
        END as android_percentage,
        CASE 
          WHEN daily_active_users > 0 
          THEN ROUND(ios_users::numeric / daily_active_users * 100, 1)
          ELSE 0 
        END as ios_percentage
      FROM daily_active_users 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
        AND daily_active_users > 0
      ORDER BY date ASC
    `;
    
    const result = await db.query(query);
    
    // Calculate platform totals
    const totalAndroid = result.rows.reduce((sum, row) => sum + (row.android_users || 0), 0);
    const totalIOS = result.rows.reduce((sum, row) => sum + (row.ios_users || 0), 0);
    const totalUsers = totalAndroid + totalIOS;
    
    res.json({
      success: true,
      data: result.rows,
      meta: {
        total_days: result.rows.length,
        platform_summary: {
          total_android_users: totalAndroid,
          total_ios_users: totalIOS,
          android_share: totalUsers > 0 ? (totalAndroid / totalUsers * 100) : 0,
          ios_share: totalUsers > 0 ? (totalIOS / totalUsers * 100) : 0
        }
      }
    });
    
  } catch (error) {
    console.error('Platform API Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch platform data',
      message: error.message 
    });
  }
});

/**
 * GET /api/analytics/health
 * Dashboard health check and data freshness
 */
router.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbCheck = await db.query('SELECT NOW() as current_time');
    
    // Check data freshness
    const freshnessCheck = await db.query(`
      SELECT 
        MAX(date) as latest_data_date,
        COUNT(*) as total_days,
        COUNT(CASE WHEN date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as recent_days
      FROM daily_kpi_summary
    `);
    
    const latestDate = freshnessCheck.rows[0]?.latest_data_date;
    const daysSinceUpdate = latestDate ? 
      Math.floor((new Date() - new Date(latestDate)) / (1000 * 60 * 60 * 24)) : null;
    
    res.json({
      success: true,
      status: 'healthy',
      database: {
        connected: true,
        current_time: dbCheck.rows[0].current_time
      },
      data_freshness: {
        latest_data_date: latestDate,
        days_since_update: daysSinceUpdate,
        total_days_available: freshnessCheck.rows[0]?.total_days || 0,
        recent_days_available: freshnessCheck.rows[0]?.recent_days || 0
      },
      api_info: {
        version: '1.1.0',
        endpoints: ['/kpi-summary', '/trends', '/retention', '/monetization', '/platform', '/tournaments'],
        authentication: 'API Key required'
      }
    });
    
  } catch (error) {
    console.error('Health Check Error:', error);
    res.status(500).json({ 
      success: false, 
      status: 'unhealthy',
      error: error.message 
    });
  }
});

/**
 * POST /api/analytics/refresh
 * Manually trigger dashboard data refresh
 */
router.post('/refresh', authenticateDashboard, async (req, res) => {
  try {
    // Call the refresh functions
    await db.query('SELECT refresh_daily_kpi_views()');
    await db.query('SELECT refresh_tournament_analytics_views()');
    
    res.json({
      success: true,
      message: 'Dashboard data refreshed successfully (including tournament analytics)',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Manual Refresh Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to refresh dashboard data',
      message: error.message 
    });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// Global error handler for analytics routes
router.use((error, req, res, next) => {
  console.error('Analytics Dashboard API Error:', error);
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

/**
 * GET /api/analytics/tournaments
 * Tournament-specific analytics data
 */
router.get('/tournaments', authenticateDashboard, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    
    // Tournament KPI Summary
    const kpiQuery = `
      SELECT 
        date,
        tournament_participants,
        tournament_completion_rate,
        tournament_revenue,
        tournament_roi,
        tournament_participation_rate,
        tournament_day1_retention,
        tournament_day7_retention,
        active_tournaments,
        total_prizes_distributed,
        tournament_score_multiplier
      FROM daily_kpi_summary_enhanced 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
        AND tournament_participants > 0  -- Only days with tournament activity
      ORDER BY date DESC
      LIMIT ${days}
    `;
    
    const kpiResult = await db.query(kpiQuery);
    
    // Tournament Trends for Charts
    const trendsQuery = `
      SELECT 
        date,
        tournament_participants,
        tournament_revenue,
        tournament_completion_rate,
        tournament_participation_rate,
        active_tournaments
      FROM daily_kpi_summary_enhanced
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
        AND tournament_participants > 0
      ORDER BY date ASC  -- Ascending for chart display
    `;
    
    const trendsResult = await db.query(trendsQuery);
    
    // Tournament Performance Summary (Recent Tournaments)
    const performanceQuery = `
      SELECT 
        tournament_name,
        tournament_type,
        start_date,
        end_date,
        status,
        total_participants,
        participation_rate,
        avg_score,
        winning_score,
        total_prizes_awarded,
        estimated_revenue_impact
      FROM tournament_performance_summary
      WHERE start_date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY start_date DESC
      LIMIT 10
    `;
    
    const performanceResult = await db.query(performanceQuery);
    
    // Calculate summary statistics
    const summaryStats = {
      total_tournament_participants: kpiResult.rows.reduce((sum, row) => sum + (row.tournament_participants || 0), 0),
      avg_completion_rate: kpiResult.rows.length > 0 ? 
        kpiResult.rows.reduce((sum, row) => sum + (row.tournament_completion_rate || 0), 0) / kpiResult.rows.length : 0,
      total_tournament_revenue: kpiResult.rows.reduce((sum, row) => sum + (row.tournament_revenue || 0), 0),
      avg_tournament_roi: kpiResult.rows.length > 0 ? 
        kpiResult.rows.reduce((sum, row) => sum + (row.tournament_roi || 0), 0) / kpiResult.rows.length : 0,
      avg_participation_rate: kpiResult.rows.length > 0 ? 
        kpiResult.rows.reduce((sum, row) => sum + (row.tournament_participation_rate || 0), 0) / kpiResult.rows.length : 0,
      total_tournaments_run: performanceResult.rows.length
    };
    
    res.json({
      success: true,
      period: `${days} days`,
      kpi_data: kpiResult.rows.map(row => ({
        ...row,
        tournament_revenue: parseFloat(row.tournament_revenue || 0),
        tournament_roi: parseFloat(row.tournament_roi || 0),
        tournament_participation_rate: parseFloat(row.tournament_participation_rate || 0),
        tournament_completion_rate: parseFloat(row.tournament_completion_rate || 0)
      })),
      trends_data: trendsResult.rows,
      tournament_performance: performanceResult.rows,
      summary_stats: summaryStats
    });
    
  } catch (error) {
    console.error('Tournament Analytics Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch tournament analytics',
      message: error.message 
    });
  }
});

module.exports = router;
