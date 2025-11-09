-- ============================================================================
-- MIGRATION: 004_analytics_aggregates.sql
-- Purpose: Create analytics aggregation tables for dashboard
-- Date: 2025-11-09
-- Author: FlappyJet Backend Team
-- ============================================================================

-- ============================================================================
-- DAILY KPI AGGREGATES (pre-calculated from events)
-- ============================================================================

-- Stores pre-calculated daily KPIs for fast dashboard queries
-- Updated by AnalyticsAggregator every hour
CREATE TABLE IF NOT EXISTS analytics_daily (
  date DATE PRIMARY KEY,
  
  -- User Metrics
  dau INTEGER DEFAULT 0,                    -- Daily Active Users
  new_users INTEGER DEFAULT 0,              -- New installs today
  returning_users INTEGER DEFAULT 0,        -- Users who returned after 1+ day
  
  -- Game Metrics
  games_started INTEGER DEFAULT 0,          -- game_started events
  games_completed INTEGER DEFAULT 0,        -- game_ended events
  avg_session_duration_seconds INTEGER DEFAULT 0,
  
  -- Economy Metrics (totals)
  total_coins_earned INTEGER DEFAULT 0,     -- From currency_earned events
  total_coins_spent INTEGER DEFAULT 0,      -- From currency_spent events
  total_gems_earned INTEGER DEFAULT 0,
  total_gems_spent INTEGER DEFAULT 0,
  
  -- Progression Metrics
  levels_completed INTEGER DEFAULT 0,       -- level_completed events
  continues_used INTEGER DEFAULT 0,         -- continue_used events
  achievements_unlocked INTEGER DEFAULT 0,  -- achievement_unlocked events
  missions_completed INTEGER DEFAULT 0,     -- mission_completed events
  
  -- Breakdown Fields (JSONB for flexibility)
  -- These store detailed breakdowns for dashboard charts
  coins_earned_by_source JSONB DEFAULT '{}',   -- {game_reward: 1000, mission: 500, ...}
  coins_spent_on JSONB DEFAULT '{}',           -- {skin_purchase: 800, continue: 200, ...}
  gems_earned_by_source JSONB DEFAULT '{}',    -- {purchase: 5000, achievement: 100, ...}
  gems_spent_on JSONB DEFAULT '{}',            -- {skin_purchase: 2000, ...}
  
  -- Game Mode Breakdown
  endless_games_played INTEGER DEFAULT 0,
  story_games_played INTEGER DEFAULT 0,
  
  -- Platform Breakdown
  ios_users INTEGER DEFAULT 0,
  android_users INTEGER DEFAULT 0,
  
  -- Metadata
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_analytics_date ON analytics_daily(date DESC);
CREATE INDEX idx_analytics_dau ON analytics_daily(dau DESC);

-- Constraints
ALTER TABLE analytics_daily ADD CONSTRAINT valid_metrics CHECK (
  dau >= 0 AND
  new_users >= 0 AND
  games_started >= 0 AND
  games_completed >= 0 AND
  total_coins_earned >= 0 AND
  total_coins_spent >= 0 AND
  total_gems_earned >= 0 AND
  total_gems_spent >= 0 AND
  levels_completed >= 0 AND
  continues_used >= 0
);

-- Comments
COMMENT ON TABLE analytics_daily IS 'Pre-calculated daily KPIs from events for dashboard';
COMMENT ON COLUMN analytics_daily.dau IS 'Daily Active Users (unique user_ids with app_launched event)';
COMMENT ON COLUMN analytics_daily.coins_earned_by_source IS 'Breakdown of coins earned: {game_reward: 1000, mission_reward: 500, ...}';
COMMENT ON COLUMN analytics_daily.coins_spent_on IS 'Breakdown of coins spent: {skin_purchase: 800, continue_purchase: 200, ...}';

-- ============================================================================
-- REAL-TIME USER STATS (updated from events)
-- ============================================================================

-- Stores aggregated stats per user (updated in real-time from events)
-- Used for user analytics and personalization
CREATE TABLE IF NOT EXISTS user_stats_realtime (
  user_id VARCHAR(255) PRIMARY KEY,
  
  -- Game Stats
  total_games_played INTEGER DEFAULT 0,
  total_score INTEGER DEFAULT 0,
  high_score INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  total_playtime_seconds INTEGER DEFAULT 0,
  
  -- Economy
  total_coins_earned INTEGER DEFAULT 0,
  total_coins_spent INTEGER DEFAULT 0,
  total_gems_earned INTEGER DEFAULT 0,
  total_gems_spent INTEGER DEFAULT 0,
  
  -- Progression
  levels_completed INTEGER DEFAULT 0,
  achievements_unlocked INTEGER DEFAULT 0,
  missions_completed INTEGER DEFAULT 0,
  skins_unlocked INTEGER DEFAULT 0,
  
  -- Engagement
  total_sessions INTEGER DEFAULT 0,
  continues_used INTEGER DEFAULT 0,
  ads_watched INTEGER DEFAULT 0,
  purchases_made INTEGER DEFAULT 0,
  
  -- Timestamps
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_stats_active ON user_stats_realtime(last_active_at DESC);
CREATE INDEX idx_user_stats_high_score ON user_stats_realtime(high_score DESC);
CREATE INDEX idx_user_stats_playtime ON user_stats_realtime(total_playtime_seconds DESC);
CREATE INDEX idx_user_stats_first_seen ON user_stats_realtime(first_seen_at DESC);

-- Constraints
ALTER TABLE user_stats_realtime ADD CONSTRAINT valid_user_stats CHECK (
  total_games_played >= 0 AND
  high_score >= 0 AND
  total_coins_earned >= 0 AND
  total_coins_spent >= 0 AND
  levels_completed >= 0
);

-- Comments
COMMENT ON TABLE user_stats_realtime IS 'Real-time aggregated stats per user from events';
COMMENT ON COLUMN user_stats_realtime.user_id IS 'Device ID from Flutter';
COMMENT ON COLUMN user_stats_realtime.total_games_played IS 'Total game_ended events for this user';
COMMENT ON COLUMN user_stats_realtime.last_active_at IS 'Last event timestamp (any event type)';

-- ============================================================================
-- HOURLY AGGREGATES (for intra-day tracking)
-- ============================================================================

-- Stores hourly aggregates for real-time dashboard
-- Updated by AnalyticsAggregator every hour
CREATE TABLE IF NOT EXISTS analytics_hourly (
  timestamp TIMESTAMP WITH TIME ZONE PRIMARY KEY,
  
  -- Core metrics
  active_users INTEGER DEFAULT 0,
  games_played INTEGER DEFAULT 0,
  coins_earned INTEGER DEFAULT 0,
  gems_earned INTEGER DEFAULT 0,
  
  -- Updated timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX idx_analytics_hourly ON analytics_hourly(timestamp DESC);

COMMENT ON TABLE analytics_hourly IS 'Hourly metrics for real-time dashboard monitoring';

-- ============================================================================
-- EVENT TYPE COUNTS (for monitoring)
-- ============================================================================

-- Track event type distribution for monitoring
CREATE TABLE IF NOT EXISTS event_counts_daily (
  date DATE NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  count INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  PRIMARY KEY (date, event_type)
);

CREATE INDEX idx_event_counts_date ON event_counts_daily(date DESC);
CREATE INDEX idx_event_counts_type ON event_counts_daily(event_type, date DESC);

COMMENT ON TABLE event_counts_daily IS 'Daily event type distribution for monitoring';

-- ============================================================================
-- HELPER VIEWS FOR DASHBOARD
-- ============================================================================

-- View: Last 7 days KPIs
CREATE OR REPLACE VIEW v_analytics_last_7_days AS
SELECT 
  date,
  dau,
  games_completed,
  total_coins_earned,
  total_gems_earned,
  levels_completed,
  continues_used
FROM analytics_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC;

COMMENT ON VIEW v_analytics_last_7_days IS 'Last 7 days of key metrics for dashboard';

-- View: Last 30 days summary
CREATE OR REPLACE VIEW v_analytics_last_30_days_summary AS
SELECT 
  COUNT(DISTINCT date) as days_with_data,
  SUM(dau) / NULLIF(COUNT(DISTINCT date), 0) as avg_dau,
  SUM(new_users) as total_new_users,
  SUM(games_completed) as total_games,
  SUM(total_coins_earned) as total_coins_earned,
  SUM(total_coins_spent) as total_coins_spent,
  SUM(total_gems_earned) as total_gems_earned,
  SUM(total_gems_spent) as total_gems_spent,
  SUM(levels_completed) as total_levels_completed,
  SUM(continues_used) as total_continues_used
FROM analytics_daily
WHERE date >= CURRENT_DATE - INTERVAL '30 days';

COMMENT ON VIEW v_analytics_last_30_days_summary IS '30-day aggregated summary for dashboard overview';

-- View: Top 100 users by playtime
CREATE OR REPLACE VIEW v_top_users_by_playtime AS
SELECT 
  user_id,
  high_score,
  total_games_played,
  total_playtime_seconds,
  total_playtime_seconds / 3600.0 as playtime_hours,
  levels_completed,
  achievements_unlocked,
  last_active_at
FROM user_stats_realtime
ORDER BY total_playtime_seconds DESC
LIMIT 100;

COMMENT ON VIEW v_top_users_by_playtime IS 'Top 100 most engaged users by playtime';

-- View: User cohorts (by first_seen week)
CREATE OR REPLACE VIEW v_user_cohorts AS
SELECT 
  DATE_TRUNC('week', first_seen_at) as cohort_week,
  COUNT(*) as users_in_cohort,
  AVG(total_games_played) as avg_games_per_user,
  AVG(total_playtime_seconds / 3600.0) as avg_hours_per_user,
  COUNT(*) FILTER (WHERE last_active_at >= CURRENT_DATE - INTERVAL '7 days') as active_last_7_days,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE last_active_at >= CURRENT_DATE - INTERVAL '7 days') / NULLIF(COUNT(*), 0),
    2
  ) as retention_7d_percent
FROM user_stats_realtime
GROUP BY DATE_TRUNC('week', first_seen_at)
ORDER BY cohort_week DESC;

COMMENT ON VIEW v_user_cohorts IS 'User cohort analysis by signup week';

-- ============================================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE (optional)
-- ============================================================================

-- For large datasets, convert views to materialized views
-- Uncomment if needed:

-- CREATE MATERIALIZED VIEW mv_analytics_last_7_days AS
-- SELECT * FROM v_analytics_last_7_days;

-- CREATE UNIQUE INDEX ON mv_analytics_last_7_days (date);

-- Refresh materialized view hourly via cron:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_analytics_last_7_days;

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'analytics_daily') THEN
    RAISE EXCEPTION 'Migration failed: analytics_daily table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_stats_realtime') THEN
    RAISE EXCEPTION 'Migration failed: user_stats_realtime table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'analytics_hourly') THEN
    RAISE EXCEPTION 'Migration failed: analytics_hourly table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_counts_daily') THEN
    RAISE EXCEPTION 'Migration failed: event_counts_daily table not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 004_analytics_aggregates.sql completed successfully';
  RAISE NOTICE '📊 Analytics tables ready for dashboard queries';
END $$;

