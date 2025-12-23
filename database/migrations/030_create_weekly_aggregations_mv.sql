-- ============================================================================
-- MIGRATION: 030_create_weekly_aggregations_mv.sql
-- Purpose: Create weekly aggregations materialized view (optimized for weekly partitions)
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Weekly Aggregations Materialized View
-- Pre-aggregates weekly metrics for faster queries over long date ranges
-- Optimized for weekly partitions (matches partition boundaries)
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_aggregations AS
WITH weekly_events AS (
  SELECT 
    DATE_TRUNC('week', received_at)::DATE as week_start,
    
    -- User Metrics
    COUNT(DISTINCT user_id) as wau, -- Weekly Active Users
    COUNT(DISTINCT CASE WHEN payload->>'platform' = 'ios' THEN user_id END) as ios_users,
    COUNT(DISTINCT CASE WHEN payload->>'platform' = 'android' THEN user_id END) as android_users,
    
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
    COUNT(CASE WHEN event_type = 'ad_watched' THEN 1 END) as ads_watched
  FROM events
  WHERE received_at >= CURRENT_DATE - INTERVAL '52 weeks' -- Keep 1 year of weekly aggregations
  GROUP BY DATE_TRUNC('week', received_at)::DATE
),
weekly_installs AS (
  SELECT 
    DATE_TRUNC('week', install_date)::DATE as week_start,
    COUNT(DISTINCT user_id) as new_installs
  FROM user_acquisitions
  WHERE install_date >= CURRENT_DATE - INTERVAL '52 weeks'
  GROUP BY DATE_TRUNC('week', install_date)::DATE
)
SELECT 
  we.week_start,
  we.wau,
  we.ios_users,
  we.android_users,
  we.total_events,
  we.unique_event_types,
  we.ad_revenue_usd,
  we.iap_revenue_usd,
  we.total_revenue_usd,
  we.games_started,
  we.games_ended,
  we.levels_completed,
  we.paying_users,
  we.purchase_count,
  we.ads_watched,
  COALESCE(wi.new_installs, 0) as new_installs
FROM weekly_events we
LEFT JOIN weekly_installs wi ON we.week_start = wi.week_start
ORDER BY we.week_start DESC;

-- Create unique index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_aggregations_week_start 
  ON weekly_aggregations(week_start);

-- Create index for date range queries
CREATE INDEX IF NOT EXISTS idx_weekly_aggregations_week_range 
  ON weekly_aggregations(week_start DESC);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON MATERIALIZED VIEW weekly_aggregations IS 
  'Weekly pre-aggregated metrics for fast queries over long date ranges (refreshed weekly, optimized for weekly partitions)';
COMMENT ON COLUMN weekly_aggregations.week_start IS 'Monday of the week (matches partition boundaries)';
COMMENT ON COLUMN weekly_aggregations.wau IS 'Weekly Active Users';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'weekly_aggregations'
  ) THEN
    RAISE EXCEPTION 'Migration failed: weekly_aggregations materialized view not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_weekly_aggregations_week_start'
  ) THEN
    RAISE EXCEPTION 'Migration failed: idx_weekly_aggregations_week_start index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 030_create_weekly_aggregations_mv.sql completed successfully';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_aggregations; to update data';
END $$;

