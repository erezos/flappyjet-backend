-- ============================================================================
-- MIGRATION: 035_create_level_performance_mv.sql
-- Purpose: Create level performance materialized view for detailed level analytics
-- Date: 2025-12-23
-- Author: FlappyJet Analytics Team
-- 
-- Tracks:
-- - Total tries and completions per level (today and 7-day average)
-- - First-time tries and completions per level (today and 7-day average)
-- ============================================================================

-- Level Performance Daily Materialized View
CREATE MATERIALIZED VIEW IF NOT EXISTS level_performance_daily AS
WITH level_events AS (
  SELECT 
    DATE(received_at) as date,
    payload->>'level_id' as level_id,
    payload->>'zone_id' as zone_id,
    event_type,
    user_id,
    -- Extract first attempt flags
    CASE 
      WHEN event_type = 'level_started' 
      THEN (payload->>'is_first_attempt')::boolean
      ELSE NULL
    END as is_first_attempt,
    CASE 
      WHEN event_type = 'level_completed' 
      THEN (payload->>'first_attempt')::boolean
      ELSE NULL
    END as first_attempt
  FROM events
  WHERE event_type IN ('level_started', 'level_completed', 'level_failed')
    AND payload->>'level_id' IS NOT NULL
    AND received_at >= CURRENT_DATE - INTERVAL '7 days'
)
SELECT 
  date,
  level_id,
  zone_id,
  
  -- Total Tries (level_started count)
  COUNT(CASE WHEN event_type = 'level_started' THEN 1 END) as total_tries,
  
  -- Total Completions (level_completed count)
  COUNT(CASE WHEN event_type = 'level_completed' THEN 1 END) as total_completions,
  
  -- First-Time Tries (level_started with is_first_attempt = true)
  COUNT(CASE WHEN event_type = 'level_started' AND is_first_attempt = true THEN 1 END) as first_tries,
  
  -- First-Time Completions (level_completed with first_attempt = true)
  COUNT(CASE WHEN event_type = 'level_completed' AND first_attempt = true THEN 1 END) as first_completions,
  
  -- Unique Users
  COUNT(DISTINCT user_id) as unique_users,
  
  -- Completion Rate
  CASE 
    WHEN COUNT(CASE WHEN event_type = 'level_started' THEN 1 END) > 0
    THEN ROUND(100.0 * COUNT(CASE WHEN event_type = 'level_completed' THEN 1 END) / 
               COUNT(CASE WHEN event_type = 'level_started' THEN 1 END), 1)
    ELSE 0
  END as completion_rate,
  
  -- First-Time Completion Rate
  CASE 
    WHEN COUNT(CASE WHEN event_type = 'level_started' AND is_first_attempt = true THEN 1 END) > 0
    THEN ROUND(100.0 * COUNT(CASE WHEN event_type = 'level_completed' AND first_attempt = true THEN 1 END) / 
               COUNT(CASE WHEN event_type = 'level_started' AND is_first_attempt = true THEN 1 END), 1)
    ELSE 0
  END as first_time_completion_rate
FROM level_events
GROUP BY date, level_id, zone_id
ORDER BY date DESC, CAST(level_id AS INTEGER);

-- Create indexes for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_level_performance_daily_date_level 
  ON level_performance_daily(date, level_id);

CREATE INDEX IF NOT EXISTS idx_level_performance_daily_date 
  ON level_performance_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_level_performance_daily_zone 
  ON level_performance_daily(zone_id, date DESC);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON MATERIALIZED VIEW level_performance_daily IS 
  'Daily level performance metrics (tries, completions, first-time attempts) - Refreshed daily';
COMMENT ON COLUMN level_performance_daily.first_tries IS 'Number of first-time attempts (is_first_attempt = true)';
COMMENT ON COLUMN level_performance_daily.first_completions IS 'Number of first-time completions (first_attempt = true)';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'level_performance_daily'
  ) THEN
    RAISE EXCEPTION 'Migration failed: level_performance_daily materialized view not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 035_create_level_performance_mv.sql completed successfully';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY level_performance_daily; to update data';
END $$;

