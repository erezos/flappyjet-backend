-- ============================================================================
-- MIGRATION: 039_fix_funnel_unique_users.sql
-- Purpose: Fix user_funnel_daily to count unique users instead of total events
-- Date: 2025-12-24
-- 
-- Issues Fixed:
-- 1. Funnel was counting total events instead of unique users
-- 2. This caused discrepancy with cohort analysis (which counts unique users)
-- ============================================================================

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS user_funnel_daily CASCADE;

-- Recreate with FIXED unique user counting
CREATE MATERIALIZED VIEW user_funnel_daily AS
WITH user_events AS (
  SELECT 
    user_id,
    DATE(received_at) as date,
    event_type,
    payload->>'level_id' as level_id
  FROM events
  WHERE event_type IN (
    'user_installed',
    'first_open',
    'tutorial_started',
    'level_started'
  )
  AND received_at >= CURRENT_DATE - INTERVAL '30 days'
),
user_funnel_steps AS (
  SELECT 
    user_id,
    date,
    MAX(CASE WHEN event_type = 'user_installed' THEN 1 ELSE 0 END) as installed,
    MAX(CASE WHEN event_type = 'first_open' THEN 1 ELSE 0 END) as first_open,
    MAX(CASE WHEN event_type = 'tutorial_started' THEN 1 ELSE 0 END) as tutorial_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '1' THEN 1 ELSE 0 END) as level_1_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '2' THEN 1 ELSE 0 END) as level_2_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '3' THEN 1 ELSE 0 END) as level_3_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '4' THEN 1 ELSE 0 END) as level_4_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '5' THEN 1 ELSE 0 END) as level_5_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '6' THEN 1 ELSE 0 END) as level_6_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '7' THEN 1 ELSE 0 END) as level_7_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '8' THEN 1 ELSE 0 END) as level_8_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '9' THEN 1 ELSE 0 END) as level_9_started,
    MAX(CASE WHEN event_type = 'level_started' AND level_id = '10' THEN 1 ELSE 0 END) as level_10_started
  FROM user_events
  GROUP BY user_id, date
)
SELECT 
  date,
  COUNT(DISTINCT CASE WHEN installed = 1 THEN user_id END) as installs, -- ✅ FIXED: Count unique users, not total events
  COUNT(DISTINCT CASE WHEN first_open = 1 THEN user_id END) as first_opens, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN tutorial_started = 1 THEN user_id END) as tutorial_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_1_started = 1 THEN user_id END) as level_1_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_2_started = 1 THEN user_id END) as level_2_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_3_started = 1 THEN user_id END) as level_3_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_4_started = 1 THEN user_id END) as level_4_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_5_started = 1 THEN user_id END) as level_5_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_6_started = 1 THEN user_id END) as level_6_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_7_started = 1 THEN user_id END) as level_7_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_8_started = 1 THEN user_id END) as level_8_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_9_started = 1 THEN user_id END) as level_9_starts, -- ✅ FIXED: Count unique users
  COUNT(DISTINCT CASE WHEN level_10_started = 1 THEN user_id END) as level_10_starts, -- ✅ FIXED: Count unique users
  
  -- Conversion Rates ✅ FIXED: Use COUNT DISTINCT for accurate conversion rates
  CASE 
    WHEN COUNT(DISTINCT CASE WHEN installed = 1 THEN user_id END) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN first_open = 1 THEN user_id END) / 
          COUNT(DISTINCT CASE WHEN installed = 1 THEN user_id END), 1)
    ELSE 0
  END as install_to_first_open_rate,
  
  CASE 
    WHEN COUNT(DISTINCT CASE WHEN first_open = 1 THEN user_id END) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN tutorial_started = 1 THEN user_id END) / 
          COUNT(DISTINCT CASE WHEN first_open = 1 THEN user_id END), 1)
    ELSE 0
  END as first_open_to_tutorial_rate,
  
  CASE 
    WHEN COUNT(DISTINCT CASE WHEN tutorial_started = 1 THEN user_id END) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN level_1_started = 1 THEN user_id END) / 
          COUNT(DISTINCT CASE WHEN tutorial_started = 1 THEN user_id END), 1)
    ELSE 0
  END as tutorial_to_level_1_rate,
  
  CASE 
    WHEN COUNT(DISTINCT CASE WHEN level_1_started = 1 THEN user_id END) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN level_10_started = 1 THEN user_id END) / 
          COUNT(DISTINCT CASE WHEN level_1_started = 1 THEN user_id END), 1)
    ELSE 0
  END as level_1_to_level_10_rate
FROM user_funnel_steps
GROUP BY date
ORDER BY date DESC;

-- Create indexes for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_funnel_daily_date 
  ON user_funnel_daily(date);

CREATE INDEX IF NOT EXISTS idx_user_funnel_daily_date_range 
  ON user_funnel_daily(date DESC);

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'user_funnel_daily'
  ) THEN
    RAISE EXCEPTION 'Migration failed: user_funnel_daily materialized view not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 039_fix_funnel_unique_users.sql completed successfully';
  RAISE NOTICE '📊 Fixed funnel to count unique users instead of total events';
  RAISE NOTICE '📊 Fixed conversion rates to use unique user counts';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY user_funnel_daily; to update data';
END $$;

