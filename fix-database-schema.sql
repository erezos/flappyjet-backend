-- Fix database schema issues for FlappyJet Backend
-- Run this to fix the 500 errors

-- 1. Create missing game_sessions table
CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL,
  player_name VARCHAR(255) NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  jet_skin VARCHAR(100) DEFAULT 'sky_jet',
  theme VARCHAR(100) DEFAULT 'sky',
  game_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT valid_score CHECK (score >= 0)
);

-- 2. Add missing columns to players table if they don't exist
ALTER TABLE players ADD COLUMN IF NOT EXISTS player_id UUID;
ALTER TABLE players ADD COLUMN IF NOT EXISTS player_name VARCHAR(255);
ALTER TABLE players ADD COLUMN IF NOT EXISTS jet_skin VARCHAR(100) DEFAULT 'sky_jet';
ALTER TABLE players ADD COLUMN IF NOT EXISTS theme VARCHAR(100) DEFAULT 'sky';
ALTER TABLE players ADD COLUMN IF NOT EXISTS total_games INTEGER DEFAULT 0;

-- 3. Update player_id to match id if it's null
UPDATE players SET player_id = id WHERE player_id IS NULL;
UPDATE players SET player_name = nickname WHERE player_name IS NULL;

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_game_sessions_player_id ON game_sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_score ON game_sessions(score DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_created_at ON game_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_player_score ON game_sessions(player_id, score DESC, created_at DESC);

-- 5. Create indexes on players table
CREATE INDEX IF NOT EXISTS idx_players_player_id ON players(player_id);
CREATE INDEX IF NOT EXISTS idx_players_best_score ON players(best_score DESC);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(player_name);

-- 6. Fix analytics events table to handle null event_name
ALTER TABLE analytics_events ALTER COLUMN event_name DROP NOT NULL;
ALTER TABLE analytics_events ALTER COLUMN event_name SET DEFAULT 'unknown_event';

-- Update any existing null event_name records
UPDATE analytics_events SET event_name = 'unknown_event' WHERE event_name IS NULL;

-- Re-add the NOT NULL constraint
ALTER TABLE analytics_events ALTER COLUMN event_name SET NOT NULL;
