-- ============================================================================
-- MIGRATION: 036_create_funnel_mv.sql
-- Purpose: Create user funnel materialized view for conversion tracking
-- Date: 2025-12-23
-- Author: FlappyJet Analytics Team
-- 
-- Funnel Steps:
-- Installs → First Open → Tutorial Started → Level 1 Started → ... → Level 10 Started
-- ============================================================================

-- User Funnel Daily Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS user_funnel_daily AS
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
  SUM(installed) as installs,
  SUM(first_open) as first_opens,
  SUM(tutorial_started) as tutorial_starts,
  SUM(level_1_started) as level_1_starts,
  SUM(level_2_started) as level_2_starts,
  SUM(level_3_started) as level_3_starts,
  SUM(level_4_started) as level_4_starts,
  SUM(level_5_started) as level_5_starts,
  SUM(level_6_started) as level_6_starts,
  SUM(level_7_started) as level_7_starts,
  SUM(level_8_started) as level_8_starts,
  SUM(level_9_started) as level_9_starts,
  SUM(level_10_started) as level_10_starts,
  
  -- Conversion Rates
  CASE 
    WHEN SUM(installed) > 0 
    THEN ROUND(100.0 * SUM(first_open) / SUM(installed), 1)
    ELSE 0
  END as install_to_first_open_rate,
  
  CASE 
    WHEN SUM(first_open) > 0 
    THEN ROUND(100.0 * SUM(tutorial_started) / SUM(first_open), 1)
    ELSE 0
  END as first_open_to_tutorial_rate,
  
  CASE 
    WHEN SUM(tutorial_started) > 0 
    THEN ROUND(100.0 * SUM(level_1_started) / SUM(tutorial_started), 1)
    ELSE 0
  END as tutorial_to_level_1_rate,
  
  CASE 
    WHEN SUM(level_1_started) > 0 
    THEN ROUND(100.0 * SUM(level_10_started) / SUM(level_1_started), 1)
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
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON MATERIALIZED VIEW user_funnel_daily IS 
  'Daily user funnel metrics (installs → first open → tutorial → levels 1-10) - Refreshed daily';
COMMENT ON COLUMN user_funnel_daily.installs IS 'Number of user_installed events';
COMMENT ON COLUMN user_funnel_daily.first_opens IS 'Number of first_open events';
COMMENT ON COLUMN user_funnel_daily.level_1_to_level_10_rate IS 'Conversion rate from level 1 to level 10 (%)';

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
  
  RAISE NOTICE '✅ Migration 036_create_funnel_mv.sql completed successfully';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY user_funnel_daily; to update data';
END $$;

