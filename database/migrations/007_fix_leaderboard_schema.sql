-- ============================================================================
-- MIGRATION: 007_fix_leaderboard_schema.sql (CORRECTED)
-- Purpose: Fix leaderboard_global - it's a materialized view, not a table!
-- Date: 2025-11-18
-- Issue: leaderboard_global is a materialized view without proper base table
-- ============================================================================

-- Step 1: Check what leaderboard_global actually is
DO $$ 
DECLARE
  is_matview BOOLEAN;
  is_table BOOLEAN;
BEGIN
  -- Check if it's a materialized view
  SELECT EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'leaderboard_global'
  ) INTO is_matview;
  
  -- Check if it's a table
  SELECT EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'leaderboard_global'
  ) INTO is_table;
  
  IF is_matview THEN
    RAISE NOTICE '📊 leaderboard_global is a MATERIALIZED VIEW (not a table)';
    RAISE NOTICE '🔧 Dropping and recreating as a proper TABLE...';
    
    -- Drop the materialized view
    DROP MATERIALIZED VIEW IF EXISTS leaderboard_global CASCADE;
    
  ELSIF is_table THEN
    RAISE NOTICE '✅ leaderboard_global is already a table';
    RETURN; -- Exit early
  ELSE
    RAISE NOTICE '⚠️ leaderboard_global does not exist, creating fresh...';
  END IF;
END $$;

-- Step 2: Create proper table structure
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

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard_global(high_score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_updated ON leaderboard_global(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_active ON leaderboard_global(last_played_at DESC);

-- Step 4: Add constraints
DO $$
BEGIN
  -- Add constraints (ignore if they already exist)
  BEGIN
    ALTER TABLE leaderboard_global ADD CONSTRAINT valid_nickname CHECK (
      LENGTH(nickname) >= 1 AND LENGTH(nickname) <= 50
    );
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Constraint already exists
  END;
  
  BEGIN
    ALTER TABLE leaderboard_global ADD CONSTRAINT valid_high_score CHECK (
      high_score >= 0
    );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  
  BEGIN
    ALTER TABLE leaderboard_global ADD CONSTRAINT valid_total_games CHECK (
      total_games >= 0
    );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  
  BEGIN
    ALTER TABLE leaderboard_global ADD CONSTRAINT valid_playtime CHECK (
      total_playtime_seconds >= 0
    );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- Step 5: Create view for top 100 (for easy queries)
DROP VIEW IF EXISTS v_leaderboard_global_top100 CASCADE;
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

COMMENT ON VIEW v_leaderboard_global_top100 IS 'View of top 100 global players';

-- Step 6: Populate table from existing events (if empty)
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM leaderboard_global;
  
  IF row_count = 0 THEN
    RAISE NOTICE '📊 Table is empty, populating from game_ended events...';
    
    INSERT INTO leaderboard_global (user_id, high_score, total_games, total_playtime_seconds, last_played_at, updated_at)
    SELECT 
      user_id,
      MAX((payload->>'score')::int) as high_score,
      COUNT(*) as total_games,
      COALESCE(SUM((payload->>'duration_seconds')::int), 0) as total_playtime_seconds,
      MAX(received_at) as last_played_at,
      NOW() as updated_at
    FROM events
    WHERE event_type = 'game_ended'
      AND (payload->>'game_mode')::text = 'endless'
      AND (payload->>'score')::int > 0
    GROUP BY user_id;
    
    GET DIAGNOSTICS row_count = ROW_COUNT;
    RAISE NOTICE '✅ Populated leaderboard with % players from historical data', row_count;
  ELSE
    RAISE NOTICE '✅ Table already has % rows, skipping population', row_count;
  END IF;
END $$;

-- Step 7: Verify the fix
DO $$
DECLARE
  col_count INTEGER;
  row_count INTEGER;
BEGIN
  -- Check user_id column exists
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns 
  WHERE table_name = 'leaderboard_global' 
  AND column_name = 'user_id';
  
  IF col_count = 0 THEN
    RAISE EXCEPTION '❌ Migration failed: user_id column still missing';
  END IF;
  
  -- Check table type
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'leaderboard_global') THEN
    RAISE EXCEPTION '❌ Migration failed: leaderboard_global is not a table';
  END IF;
  
  SELECT COUNT(*) INTO row_count FROM leaderboard_global;
  
  RAISE NOTICE '✅ Migration 007_fix_leaderboard_schema.sql completed successfully';
  RAISE NOTICE '📊 leaderboard_global is now a proper TABLE with user_id column';
  RAISE NOTICE '📈 Current leaderboard has % players', row_count;
END $$;
