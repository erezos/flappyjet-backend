-- ============================================================================
-- MIGRATION: 002_event_leaderboards.sql
-- Purpose: Create leaderboard tables calculated from events
-- Date: 2025-11-09
-- Author: FlappyJet Backend Team
-- ============================================================================

-- ============================================================================
-- GLOBAL LEADERBOARD (calculated from game_ended events)
-- ============================================================================

-- Stores the best scores from endless mode across all time
-- Updated by LeaderboardAggregator every 5 minutes
CREATE TABLE IF NOT EXISTS leaderboard_global (
  user_id VARCHAR(255) PRIMARY KEY,
  nickname VARCHAR(50) DEFAULT 'Pilot',
  high_score INTEGER NOT NULL DEFAULT 0,
  total_games INTEGER DEFAULT 0,
  total_playtime_seconds INTEGER DEFAULT 0,
  last_played_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for leaderboard queries
CREATE INDEX idx_leaderboard_score ON leaderboard_global(high_score DESC);
CREATE INDEX idx_leaderboard_updated ON leaderboard_global(updated_at DESC);
CREATE INDEX idx_leaderboard_active ON leaderboard_global(last_played_at DESC);

-- Constraints
ALTER TABLE leaderboard_global ADD CONSTRAINT valid_nickname CHECK (
  LENGTH(nickname) >= 1 AND LENGTH(nickname) <= 50
);

ALTER TABLE leaderboard_global ADD CONSTRAINT valid_high_score CHECK (
  high_score >= 0
);

ALTER TABLE leaderboard_global ADD CONSTRAINT valid_total_games CHECK (
  total_games >= 0
);

ALTER TABLE leaderboard_global ADD CONSTRAINT valid_playtime CHECK (
  total_playtime_seconds >= 0
);

-- Comments
COMMENT ON TABLE leaderboard_global IS 'Global leaderboard calculated from game_ended events (endless mode)';
COMMENT ON COLUMN leaderboard_global.user_id IS 'Device ID from Flutter';
COMMENT ON COLUMN leaderboard_global.nickname IS 'Player nickname (customizable)';
COMMENT ON COLUMN leaderboard_global.high_score IS 'Highest score in endless mode';
COMMENT ON COLUMN leaderboard_global.total_games IS 'Total games played (all modes)';
COMMENT ON COLUMN leaderboard_global.total_playtime_seconds IS 'Total time played (seconds)';
COMMENT ON COLUMN leaderboard_global.last_played_at IS 'Last game_ended event timestamp';

-- ============================================================================
-- TOURNAMENT LEADERBOARD (calculated from game_ended events in tournament period)
-- ============================================================================

-- Stores tournament entries for each weekly tournament
-- Updated by LeaderboardAggregator every 2 minutes
CREATE TABLE IF NOT EXISTS tournament_leaderboard (
  tournament_id VARCHAR(100) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) DEFAULT 'Pilot',
  best_score INTEGER NOT NULL DEFAULT 0,
  total_attempts INTEGER DEFAULT 0,
  first_attempt_at TIMESTAMP WITH TIME ZONE,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (tournament_id, user_id)
);

-- Indexes for tournament queries
CREATE INDEX idx_tournament_score ON tournament_leaderboard(tournament_id, best_score DESC);
CREATE INDEX idx_tournament_user ON tournament_leaderboard(user_id);
CREATE INDEX idx_tournament_attempts ON tournament_leaderboard(tournament_id, total_attempts DESC);
CREATE INDEX idx_tournament_recent ON tournament_leaderboard(tournament_id, last_attempt_at DESC);

-- Constraints
ALTER TABLE tournament_leaderboard ADD CONSTRAINT valid_tournament_nickname CHECK (
  LENGTH(nickname) >= 1 AND LENGTH(nickname) <= 50
);

ALTER TABLE tournament_leaderboard ADD CONSTRAINT valid_tournament_score CHECK (
  best_score >= 0
);

ALTER TABLE tournament_leaderboard ADD CONSTRAINT valid_tournament_attempts CHECK (
  total_attempts >= 0
);

-- Comments
COMMENT ON TABLE tournament_leaderboard IS 'Tournament leaderboard calculated from game_ended events (endless mode only, within tournament period)';
COMMENT ON COLUMN tournament_leaderboard.tournament_id IS 'Tournament identifier (e.g., tournament_2025_w45)';
COMMENT ON COLUMN tournament_leaderboard.user_id IS 'Device ID from Flutter';
COMMENT ON COLUMN tournament_leaderboard.best_score IS 'Best score in this tournament';
COMMENT ON COLUMN tournament_leaderboard.total_attempts IS 'Number of games played in tournament';
COMMENT ON COLUMN tournament_leaderboard.first_attempt_at IS 'First game in tournament';
COMMENT ON COLUMN tournament_leaderboard.last_attempt_at IS 'Most recent game in tournament';

-- ============================================================================
-- LEADERBOARD CACHE METADATA
-- ============================================================================

-- Track when leaderboards were last updated (for cache invalidation)
CREATE TABLE IF NOT EXISTS leaderboard_cache_metadata (
  cache_key VARCHAR(255) PRIMARY KEY,
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  entry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default entries
INSERT INTO leaderboard_cache_metadata (cache_key, entry_count) 
VALUES 
  ('global_top100', 0),
  ('global_top1000', 0)
ON CONFLICT (cache_key) DO NOTHING;

COMMENT ON TABLE leaderboard_cache_metadata IS 'Track leaderboard cache freshness for Redis invalidation';

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Top 100 global leaderboard (used by API)
CREATE OR REPLACE VIEW v_leaderboard_global_top100 AS
SELECT 
  user_id,
  nickname,
  high_score,
  total_games,
  last_played_at,
  ROW_NUMBER() OVER (ORDER BY high_score DESC, last_played_at DESC) as rank
FROM leaderboard_global
ORDER BY high_score DESC, last_played_at DESC
LIMIT 100;

COMMENT ON VIEW v_leaderboard_global_top100 IS 'Materialized view of top 100 global players';

-- View: Tournament top 50 (parameterized by tournament_id in query)
-- Example: SELECT * FROM v_tournament_top50 WHERE tournament_id = 'tournament_2025_w45'
CREATE OR REPLACE VIEW v_tournament_leaderboard AS
SELECT 
  tournament_id,
  user_id,
  nickname,
  best_score,
  total_attempts,
  last_attempt_at,
  ROW_NUMBER() OVER (PARTITION BY tournament_id ORDER BY best_score DESC, last_attempt_at DESC) as rank
FROM tournament_leaderboard
ORDER BY tournament_id, best_score DESC, last_attempt_at DESC;

COMMENT ON VIEW v_tournament_leaderboard IS 'Tournament leaderboard with ranks';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leaderboard_global') THEN
    RAISE EXCEPTION 'Migration failed: leaderboard_global table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_leaderboard') THEN
    RAISE EXCEPTION 'Migration failed: tournament_leaderboard table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leaderboard_cache_metadata') THEN
    RAISE EXCEPTION 'Migration failed: leaderboard_cache_metadata table not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 002_event_leaderboards.sql completed successfully';
END $$;

