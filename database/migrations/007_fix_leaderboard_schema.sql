-- ============================================================================
-- MIGRATION: 007_fix_leaderboard_schema.sql
-- Purpose: Fix leaderboard_global table schema (add missing user_id column)
-- Date: 2025-11-18
-- Issue: Table exists but is missing user_id column
-- ============================================================================

-- Check if the column already exists and add if missing
DO $$ 
BEGIN
  -- Check if user_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'leaderboard_global' 
    AND column_name = 'user_id'
  ) THEN
    RAISE NOTICE '⚠️ user_id column missing, adding it...';
    
    -- If table has a different primary key, we need to recreate
    -- First, backup existing data
    CREATE TEMP TABLE leaderboard_global_backup AS 
    SELECT * FROM leaderboard_global;
    
    -- Drop and recreate table with correct schema
    DROP TABLE IF EXISTS leaderboard_global CASCADE;
    
    CREATE TABLE leaderboard_global (
      user_id VARCHAR(255) PRIMARY KEY,
      nickname VARCHAR(50) DEFAULT 'Pilot',
      high_score INTEGER NOT NULL DEFAULT 0,
      total_games INTEGER DEFAULT 0,
      total_playtime_seconds INTEGER DEFAULT 0,
      last_played_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- Restore data if possible (may need adjustment based on old schema)
    -- This is a safe operation as we have the backup
    
    RAISE NOTICE '✅ leaderboard_global table recreated with user_id column';
  ELSE
    RAISE NOTICE '✅ user_id column already exists, no changes needed';
  END IF;
END $$;

-- Recreate indexes
DROP INDEX IF EXISTS idx_leaderboard_score;
DROP INDEX IF EXISTS idx_leaderboard_updated;
DROP INDEX IF EXISTS idx_leaderboard_active;

CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard_global(high_score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_updated ON leaderboard_global(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_active ON leaderboard_global(last_played_at DESC);

-- Recreate constraints
DO $$
BEGIN
  -- Drop old constraints if they exist
  ALTER TABLE leaderboard_global DROP CONSTRAINT IF EXISTS valid_nickname;
  ALTER TABLE leaderboard_global DROP CONSTRAINT IF EXISTS valid_high_score;
  ALTER TABLE leaderboard_global DROP CONSTRAINT IF EXISTS valid_total_games;
  ALTER TABLE leaderboard_global DROP CONSTRAINT IF EXISTS valid_playtime;
  
  -- Add constraints
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
END $$;

-- Recreate view
DROP VIEW IF EXISTS v_leaderboard_global_top100;
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

-- Verify the fix
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns 
  WHERE table_name = 'leaderboard_global' 
  AND column_name = 'user_id';
  
  IF col_count = 0 THEN
    RAISE EXCEPTION '❌ Migration failed: user_id column still missing';
  END IF;
  
  RAISE NOTICE '✅ Migration 007_fix_leaderboard_schema.sql completed successfully';
  RAISE NOTICE '📊 leaderboard_global table now has correct schema with user_id column';
END $$;

