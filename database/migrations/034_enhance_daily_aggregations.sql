-- ============================================================================
-- MIGRATION: 034_enhance_daily_aggregations.sql
-- Purpose: Enhance daily_aggregations materialized view with new metrics
-- Date: 2025-12-23
-- Author: FlappyJet Analytics Team
-- 
-- New metrics:
-- - mau: Monthly Active Users (count distinct users in last 30 days)
-- - avg_games_per_user: Games started / DAU
-- - avg_sessions_per_user: Distinct sessions / DAU
-- - avg_session_length_seconds: Average session duration
-- ============================================================================

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS daily_aggregations CASCADE;

-- Recreate with enhanced metrics
CREATE MATERIALIZED VIEW daily_aggregations AS
WITH daily_metrics AS (
  SELECT 
    DATE(received_at) as date,
    
    -- User Metrics
    COUNT(DISTINCT user_id) as dau,
    COUNT(DISTINCT CASE WHEN event_type IN ('app_launched', 'game_started') THEN user_id END) as active_users,
    
    -- Event Metrics
    COUNT(*) as total_events,
    COUNT(DISTINCT event_type) as unique_event_types,
    
    -- Revenue Metrics
    SUM(CASE WHEN event_type = 'ad_revenue' AND payload->>'revenue_usd' IS NOT NULL 
      THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as ad_revenue_usd,
    SUM(CASE WHEN event_type = 'purchase_completed' AND payload->>'revenue_usd' IS NOT NULL 
      THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as iap_revenue_usd,
    SUM(CASE WHEN event_type IN ('ad_revenue', 'purchase_completed') AND payload->>'revenue_usd' IS NOT NULL 
      THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as total_revenue_usd,
    
    -- Gameplay Metrics
    COUNT(CASE WHEN event_type = 'game_started' THEN 1 END) as games_started,
    COUNT(CASE WHEN event_type = 'game_ended' THEN 1 END) as games_ended,
    COUNT(CASE WHEN event_type = 'level_completed' THEN 1 END) as levels_completed,
    
    -- Monetization Metrics
    COUNT(DISTINCT CASE WHEN event_type = 'purchase_completed' THEN user_id END) as paying_users,
    COUNT(CASE WHEN event_type = 'purchase_completed' THEN 1 END) as purchase_count,
    COUNT(CASE WHEN event_type = 'ad_watched' THEN 1 END) as ads_watched,
    
    -- Session Metrics ✅ NEW
    COUNT(DISTINCT CASE WHEN event_type = 'session_started' THEN payload->>'session_id' END) as total_sessions,
    AVG(CASE WHEN event_type = 'session_ended' AND (payload->>'duration_seconds')::numeric > 0 
      THEN (payload->>'duration_seconds')::numeric ELSE NULL END) as avg_session_length_seconds,
    
    -- Platform Breakdown
    COUNT(DISTINCT CASE WHEN payload->>'platform' = 'ios' THEN user_id END) as ios_users,
    COUNT(DISTINCT CASE WHEN payload->>'platform' = 'android' THEN user_id END) as android_users
  FROM events
  WHERE received_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY DATE(received_at)
),
mau_calculation AS (
  -- Calculate MAU for each date (count distinct users in last 30 days)
  SELECT 
    date,
    COUNT(DISTINCT user_id) as mau
  FROM (
    SELECT DISTINCT
      DATE(received_at) as date,
      user_id
    FROM events
    WHERE received_at >= CURRENT_DATE - INTERVAL '90 days'
      AND event_type IN ('app_launched', 'game_started', 'session_started')
  ) daily_users
  WHERE date >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY date
)
SELECT 
  dm.date,
  
  -- User Metrics
  dm.dau,
  COALESCE(mc.mau, dm.dau) as mau, -- ✅ NEW: Monthly Active Users (fallback to DAU if no MAU data)
  dm.active_users,
  
  -- Event Metrics
  dm.total_events,
  dm.unique_event_types,
  
  -- Revenue Metrics
  dm.ad_revenue_usd,
  dm.iap_revenue_usd,
  dm.total_revenue_usd,
  
  -- Gameplay Metrics
  dm.games_started,
  dm.games_ended,
  dm.levels_completed,
  
  -- ✅ NEW: Calculated Metrics
  CASE 
    WHEN dm.dau > 0 
    THEN ROUND((dm.games_started::numeric / dm.dau), 2)
    ELSE 0
  END as avg_games_per_user,
  
  CASE 
    WHEN dm.dau > 0 AND dm.total_sessions > 0
    THEN ROUND((dm.total_sessions::numeric / dm.dau), 2)
    ELSE 0
  END as avg_sessions_per_user,
  
  CASE 
    WHEN dm.avg_session_length_seconds IS NOT NULL
    THEN ROUND(dm.avg_session_length_seconds, 0)
    ELSE 0
  END as avg_session_length_seconds,
  
  -- Monetization Metrics
  dm.paying_users,
  dm.purchase_count,
  dm.ads_watched,
  
  -- Session Metrics ✅ NEW
  dm.total_sessions,
  
  -- Platform Breakdown
  dm.ios_users,
  dm.android_users
FROM daily_metrics dm
LEFT JOIN mau_calculation mc ON dm.date = mc.date
ORDER BY dm.date DESC;

-- Create unique index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_aggregations_date 
  ON daily_aggregations(date);

-- Create index for date range queries
CREATE INDEX IF NOT EXISTS idx_daily_aggregations_date_range 
  ON daily_aggregations(date DESC);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON MATERIALIZED VIEW daily_aggregations IS 
  'Daily pre-aggregated metrics for fast dashboard queries (refreshed daily) - Enhanced with MAU, avg games/sessions per user, session length';
COMMENT ON COLUMN daily_aggregations.mau IS 'Monthly Active Users (count distinct users in last 30 days)';
COMMENT ON COLUMN daily_aggregations.avg_games_per_user IS 'Average games per user (games_started / dau)';
COMMENT ON COLUMN daily_aggregations.avg_sessions_per_user IS 'Average sessions per user (total_sessions / dau)';
COMMENT ON COLUMN daily_aggregations.avg_session_length_seconds IS 'Average session duration in seconds';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'daily_aggregations'
  ) THEN
    RAISE EXCEPTION 'Migration failed: daily_aggregations materialized view not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 034_enhance_daily_aggregations.sql completed successfully';
  RAISE NOTICE '📊 Enhanced daily_aggregations with: MAU, avg_games_per_user, avg_sessions_per_user, avg_session_length_seconds';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY daily_aggregations; to update data';
END $$;

