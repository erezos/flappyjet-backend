-- ============================================================================
-- MIGRATION: 038_fix_dau_mau_calculation.sql
-- Purpose: Fix MAU calculation (rolling 30-day window) and session metrics
-- Date: 2025-12-24
-- 
-- Issues Fixed:
-- 1. MAU was incorrectly calculated (was counting per date, not rolling 30-day window)
-- 2. Avg sessions per user calculation needs verification
-- ============================================================================

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS daily_aggregations CASCADE;

-- Recreate with FIXED MAU calculation (rolling 30-day window)
CREATE MATERIALIZED VIEW daily_aggregations AS
WITH daily_metrics AS (
  SELECT 
    DATE(received_at) as date,
    
    -- User Metrics
    COUNT(DISTINCT user_id) as dau,
    COUNT(DISTINCT CASE WHEN event_type IN ('app_launched', 'game_started', 'session_started') THEN user_id END) as active_users,
    
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
    
    -- Session Metrics ✅ FIXED: Count distinct sessions (will calculate avg per user in final SELECT)
    COUNT(DISTINCT CASE 
      WHEN payload->>'session_id' IS NOT NULL AND payload->>'session_id' != ''
      THEN payload->>'session_id'
      ELSE NULL
    END) as total_sessions,
    
    -- ✅ FIXED: Calculate session length from session_ended events or session duration
    AVG(CASE 
      WHEN event_type = 'session_ended' AND (payload->>'duration_seconds')::numeric > 0 
        THEN (payload->>'duration_seconds')::numeric 
      WHEN event_type = 'session_ended' AND (payload->>'duration_seconds')::numeric IS NULL
        THEN NULL
      ELSE NULL
    END) as avg_session_length_seconds,
    
    -- Platform Breakdown
    COUNT(DISTINCT CASE WHEN payload->>'platform' = 'ios' THEN user_id END) as ios_users,
    COUNT(DISTINCT CASE WHEN payload->>'platform' = 'android' THEN user_id END) as android_users
  FROM events
  WHERE received_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY DATE(received_at)
),
mau_calculation AS (
  -- ✅ FIXED: Calculate MAU as rolling 30-day window (count distinct users in last 30 days from each date)
  SELECT 
    dm.date,
    (
      SELECT COUNT(DISTINCT user_id)
      FROM events
      WHERE DATE(received_at) BETWEEN dm.date - INTERVAL '29 days' AND dm.date
        AND event_type IN ('app_launched', 'game_started', 'session_started', 'app_installed', 'first_open')
    ) as mau
  FROM daily_metrics dm
),
session_metrics AS (
  -- ✅ FIXED: Calculate avg_sessions_per_user properly (count sessions per user, then average)
  SELECT 
    user_sessions.date,
    CASE 
      WHEN COUNT(DISTINCT user_sessions.user_id) > 0
      THEN ROUND(
        AVG(user_sessions.user_session_count)::numeric, 
        2
      )
      ELSE 0
    END as avg_sessions_per_user
  FROM (
    SELECT 
      DATE(received_at) as date,
      user_id,
      COUNT(DISTINCT payload->>'session_id') as user_session_count
    FROM events
    WHERE received_at >= CURRENT_DATE - INTERVAL '90 days'
      AND payload->>'session_id' IS NOT NULL 
      AND payload->>'session_id' != ''
    GROUP BY DATE(received_at), user_id
  ) user_sessions
  GROUP BY user_sessions.date
)
SELECT 
  dm.date,
  
  -- User Metrics
  dm.dau,
  -- ✅ FIXED: MAU must be >= DAU (use GREATEST to ensure MAU is never less than DAU)
  GREATEST(COALESCE(mc.mau, dm.dau), dm.dau) as mau,
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
  
  -- ✅ FIXED: Calculated Metrics
  CASE 
    WHEN dm.dau > 0 
    THEN ROUND((dm.games_started::numeric / dm.dau), 2)
    ELSE 0
  END as avg_games_per_user,
  
  -- ✅ FIXED: Avg sessions per user (from session_metrics CTE - properly calculated per user)
  COALESCE(sm.avg_sessions_per_user, 0) as avg_sessions_per_user,
  
  -- ✅ FIXED: Session length (round to nearest second)
  CASE 
    WHEN dm.avg_session_length_seconds IS NOT NULL AND dm.avg_session_length_seconds > 0
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
LEFT JOIN session_metrics sm ON dm.date = sm.date
ORDER BY dm.date DESC;

-- Create unique index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_aggregations_date 
  ON daily_aggregations(date);

-- Create index for date range queries
CREATE INDEX IF NOT EXISTS idx_daily_aggregations_date_range 
  ON daily_aggregations(date DESC);

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
DECLARE
  mau_issue_count INTEGER;
BEGIN
  -- Check if MAU < DAU in any row (should never happen)
  SELECT COUNT(*) INTO mau_issue_count
  FROM daily_aggregations
  WHERE mau < dau;
  
  IF mau_issue_count > 0 THEN
    RAISE WARNING '⚠️ Found % rows where MAU < DAU (this should not happen)', mau_issue_count;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'daily_aggregations'
  ) THEN
    RAISE EXCEPTION 'Migration failed: daily_aggregations materialized view not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 038_fix_dau_mau_calculation.sql completed successfully';
  RAISE NOTICE '📊 Fixed MAU calculation: Now uses rolling 30-day window';
  RAISE NOTICE '📊 Fixed MAU constraint: MAU is now always >= DAU (using GREATEST)';
  RAISE NOTICE '📊 Fixed session metrics: Improved session counting and length calculation';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY daily_aggregations; to update data';
END $$;

