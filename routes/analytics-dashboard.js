/**
 * 📊 Analytics Dashboard Routes - Gaming KPIs
 * Optimized for FlappyJet game analytics
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

module.exports = (db) => {
  
  // Dashboard API key authentication
const authenticateDashboard = (req, res, next) => {
    const apiKey = req.query.api_key || req.headers['x-api-key'];
    const validKey = process.env.DASHBOARD_API_KEY || 'flappyjet-analytics-2024';
  
    if (apiKey !== validKey) {
    return res.status(401).json({ 
        success: false,
        error: 'Invalid API key'
    });
  }
  next();
};

  /**
   * GET /api/analytics/dashboard/kpis - Gaming Analytics Dashboard
   * Returns comprehensive gaming metrics
   */
  router.get('/dashboard/kpis', authenticateDashboard, async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 30, 90);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      logger.info(`📊 Dashboard KPI request: ${days} days`);
      
      // Get today's metrics
      const todayQuery = `
        WITH today_data AS (
      SELECT 
            -- DAU (Daily Active Users)
            COUNT(DISTINCT player_id) FILTER (WHERE player_id IS NOT NULL) as dau,
            
            -- Games played today
            COUNT(*) FILTER (WHERE event_name = 'game_over') as games_played,
            
            -- Continue usage
            COUNT(*) FILTER (WHERE event_name = 'continue_used') as continues_total,
            COUNT(*) FILTER (WHERE event_name = 'continue_used' AND 
              (parameters->>'continue_type' = 'ad' OR parameters->>'method' = 'ad')) as continues_ad,
            COUNT(*) FILTER (WHERE event_name = 'continue_used' AND 
              (parameters->>'continue_type' = 'gems' OR parameters->>'method' = 'gems')) as continues_gems,
            
            -- Ad metrics
            COUNT(*) FILTER (WHERE event_name = 'ad_shown') as ads_shown,
            COUNT(*) FILTER (WHERE event_name = 'ad_completed') as ads_completed,
            
            -- Purchases
            COUNT(DISTINCT (parameters->>'transaction_id')) FILTER (
              WHERE event_name = 'iap_purchase' AND parameters->>'transaction_id' IS NOT NULL
            ) as purchases_today,
            SUM((parameters->>'price_usd')::decimal) FILTER (
              WHERE event_name = 'iap_purchase'
            ) as revenue_today,
            
            -- Jet skins bought
            COUNT(*) FILTER (WHERE event_name = 'skin_purchased') as skins_bought,
            
            -- Daily missions completed
            COUNT(DISTINCT player_id) FILTER (
              WHERE event_name = 'mission_complete' AND 
              parameters->>'mission_type' = 'daily'
            ) as missions_completed
            
          FROM analytics_events
          WHERE created_at >= CURRENT_DATE
            AND created_at < CURRENT_DATE + INTERVAL '1 day'
        )
      SELECT 
          dau,
          games_played,
          continues_total,
          continues_ad,
          continues_gems,
          ads_shown,
          ads_completed,
          CASE 
            WHEN ads_shown > 0 THEN ROUND((ads_completed::decimal / ads_shown * 100), 1)
            ELSE 0 
          END as ad_completion_rate,
          purchases_today,
          COALESCE(revenue_today, 0) as revenue_today,
          skins_bought,
          missions_completed
        FROM today_data;
      `;
      
      const todayResult = await db.query(todayQuery);
      const today = todayResult.rows[0] || {};
      
      // Get retention metrics (D1, D7, D30)
      const retentionQuery = `
        WITH user_first_seen AS (
          SELECT 
            player_id,
            DATE(MIN(created_at)) as first_seen_date
          FROM analytics_events
          WHERE player_id IS NOT NULL
            AND created_at >= $1
          GROUP BY player_id
        ),
        retention_cohorts AS (
          SELECT 
            ufs.first_seen_date as cohort_date,
            COUNT(DISTINCT ufs.player_id) as cohort_size,
            
            -- D1 Retention
            COUNT(DISTINCT CASE 
              WHEN EXISTS (
                SELECT 1 FROM analytics_events ae
                WHERE ae.player_id = ufs.player_id
                  AND DATE(ae.created_at) = ufs.first_seen_date + INTERVAL '1 day'
              ) THEN ufs.player_id 
            END) as d1_retained,
            
            -- D7 Retention
            COUNT(DISTINCT CASE 
              WHEN EXISTS (
                SELECT 1 FROM analytics_events ae
                WHERE ae.player_id = ufs.player_id
                  AND DATE(ae.created_at) = ufs.first_seen_date + INTERVAL '7 days'
              ) THEN ufs.player_id 
            END) as d7_retained,
            
            -- D30 Retention
            COUNT(DISTINCT CASE 
              WHEN EXISTS (
                SELECT 1 FROM analytics_events ae
                WHERE ae.player_id = ufs.player_id
                  AND DATE(ae.created_at) = ufs.first_seen_date + INTERVAL '30 days'
              ) THEN ufs.player_id 
            END) as d30_retained
            
          FROM user_first_seen ufs
          WHERE ufs.first_seen_date >= $1
          GROUP BY ufs.first_seen_date
        )
      SELECT 
          SUM(cohort_size) as total_cohort_size,
          CASE 
            WHEN SUM(cohort_size) > 0 
            THEN ROUND((SUM(d1_retained)::decimal / SUM(cohort_size) * 100), 1)
            ELSE 0 
          END as d1_retention,
          CASE 
            WHEN SUM(cohort_size) > 0 
            THEN ROUND((SUM(d7_retained)::decimal / SUM(cohort_size) * 100), 1)
            ELSE 0 
          END as d7_retention,
          CASE 
            WHEN SUM(cohort_size) > 0 
            THEN ROUND((SUM(d30_retained)::decimal / SUM(cohort_size) * 100), 1)
            ELSE 0 
          END as d30_retention
        FROM retention_cohorts;
      `;
      
      const retentionResult = await db.query(retentionQuery, [startDate]);
      const retention = retentionResult.rows[0] || {};
      
      // Get period comparison (previous period)
      const previousStartDate = new Date(startDate);
      previousStartDate.setDate(previousStartDate.getDate() - days);
      
      const comparisonQuery = `
      SELECT 
          COUNT(DISTINCT player_id) FILTER (WHERE player_id IS NOT NULL) as prev_dau,
          COUNT(*) FILTER (WHERE event_name = 'game_over') as prev_games,
          COUNT(*) FILTER (WHERE event_name = 'ad_completed') as prev_ads_completed,
          COUNT(DISTINCT (parameters->>'transaction_id')) FILTER (
            WHERE event_name = 'iap_purchase' AND parameters->>'transaction_id' IS NOT NULL
          ) as prev_purchases,
          SUM((parameters->>'price_usd')::decimal) FILTER (
            WHERE event_name = 'iap_purchase'
          ) as prev_revenue
        FROM analytics_events
        WHERE created_at >= $1
          AND created_at < $2;
      `;
      
      const comparisonResult = await db.query(comparisonQuery, [previousStartDate, startDate]);
      const previous = comparisonResult.rows[0] || {};
      
      // Calculate percentage changes
      const calculateChange = (current, previous) => {
        if (!previous || previous === 0) return 0;
        return Math.round(((current - previous) / previous) * 100);
      };
      
      const response = {
      success: true,
        data: {
          // Today's metrics
          dau_today: parseInt(today.dau) || 0,
          games_played_today: parseInt(today.games_played) || 0,
          
          // Continue usage
          continues_total: parseInt(today.continues_total) || 0,
          continues_ad: parseInt(today.continues_ad) || 0,
          continues_gems: parseInt(today.continues_gems) || 0,
          continue_usage_rate: today.games_played > 0 
            ? Math.round((today.continues_total / today.games_played) * 100 * 10) / 10
            : 0,
          
          // Ad metrics
          ads_shown: parseInt(today.ads_shown) || 0,
          ads_completed: parseInt(today.ads_completed) || 0,
          ad_completion_rate: parseFloat(today.ad_completion_rate) || 0,
          
          // Monetization
          purchases_today: parseInt(today.purchases_today) || 0,
          revenue_today: parseFloat(today.revenue_today) || 0,
          skins_bought_today: parseInt(today.skins_bought) || 0,
          
          // Missions
          missions_completed_today: parseInt(today.missions_completed) || 0,
          
          // Retention
          d1_retention: parseFloat(retention.d1_retention) || 0,
          d7_retention: parseFloat(retention.d7_retention) || 0,
          d30_retention: parseFloat(retention.d30_retention) || 0,
          
          // Period comparisons
          dau_change: calculateChange(today.dau, previous.prev_dau),
          games_change: calculateChange(today.games_played, previous.prev_games),
          ad_change: calculateChange(today.ads_completed, previous.prev_ads_completed),
          purchases_change: calculateChange(today.purchases_today, previous.prev_purchases),
          revenue_change: calculateChange(today.revenue_today, previous.prev_revenue),
        },
      meta: {
          period_days: days,
          start_date: startDate.toISOString(),
          generated_at: new Date().toISOString()
        }
      };
      
      logger.info('📊 Dashboard KPIs generated successfully', {
        dau: response.data.dau_today,
        games: response.data.games_played_today,
        revenue: response.data.revenue_today
      });
      
      res.json(response);
    
  } catch (error) {
      logger.error('📊 Dashboard KPI error:', error);
    res.status(500).json({ 
      success: false, 
        error: 'Failed to generate dashboard metrics',
      message: error.message 
    });
  }
});

  return router;
};