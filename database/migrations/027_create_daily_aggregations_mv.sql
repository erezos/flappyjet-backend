-- ============================================================================
-- MIGRATION: 027_create_daily_aggregations_mv.sql
-- Purpose: Create daily aggregations materialized view for dashboard performance
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Daily Aggregations Materialized View
-- Pre-aggregates daily metrics for fast dashboard queries
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_aggregations AS
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
  
  -- Platform Breakdown
  COUNT(DISTINCT CASE WHEN payload->>'platform' = 'ios' THEN user_id END) as ios_users,
  COUNT(DISTINCT CASE WHEN payload->>'platform' = 'android' THEN user_id END) as android_users
FROM events
WHERE received_at >= CURRENT_DATE - INTERVAL '90 days' -- Keep 90 days of daily aggregations
GROUP BY DATE(received_at)
ORDER BY date DESC;

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
  'Daily pre-aggregated metrics for fast dashboard queries (refreshed daily)';
COMMENT ON COLUMN daily_aggregations.date IS 'Date of the aggregation';
COMMENT ON COLUMN daily_aggregations.dau IS 'Daily Active Users';
COMMENT ON COLUMN daily_aggregations.total_revenue_usd IS 'Total revenue (ads + IAP) in USD';

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
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_daily_aggregations_date'
  ) THEN
    RAISE EXCEPTION 'Migration failed: idx_daily_aggregations_date index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 027_create_daily_aggregations_mv.sql completed successfully';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY daily_aggregations; to update data';
END $$;

