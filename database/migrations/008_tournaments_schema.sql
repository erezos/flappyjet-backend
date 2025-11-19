-- ============================================================================
-- MIGRATION: 008_tournaments_schema.sql
-- Purpose: Create complete tournament system tables and functions
-- Date: 2025-11-19
-- Author: FlappyJet Backend Team
-- ============================================================================

-- ============================================================================
-- TOURNAMENTS TABLE (main tournament metadata)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tournaments (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  tournament_type VARCHAR(50) DEFAULT 'weekly',
  status VARCHAR(20) DEFAULT 'upcoming',
  
  -- Timing
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  registration_start TIMESTAMP WITH TIME ZONE,
  registration_end TIMESTAMP WITH TIME ZONE,
  
  -- Participants
  max_participants INTEGER DEFAULT 10000,
  entry_fee INTEGER DEFAULT 0,
  
  -- Prizes
  prize_pool INTEGER DEFAULT 1000,
  prize_distribution JSONB,
  
  -- Settings
  game_mode VARCHAR(50) DEFAULT 'endless',
  min_score_required INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT valid_tournament_status CHECK (
    status IN ('upcoming', 'active', 'ended', 'cancelled')
  ),
  CONSTRAINT valid_dates CHECK (
    end_date > start_date
  ),
  CONSTRAINT valid_max_participants CHECK (
    max_participants > 0
  ),
  CONSTRAINT valid_entry_fee CHECK (
    entry_fee >= 0
  ),
  CONSTRAINT valid_prize_pool CHECK (
    prize_pool >= 0
  )
);

-- Indexes
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_dates ON tournaments(start_date, end_date);
CREATE INDEX idx_tournaments_type ON tournaments(tournament_type);
CREATE INDEX idx_tournaments_active ON tournaments(status, start_date) 
  WHERE status IN ('upcoming', 'active');

-- Comments
COMMENT ON TABLE tournaments IS 'Tournament metadata and configuration';
COMMENT ON COLUMN tournaments.id IS 'Unique tournament identifier (e.g., tournament_2025_w47)';
COMMENT ON COLUMN tournaments.status IS 'Current status: upcoming, active, ended, cancelled';
COMMENT ON COLUMN tournaments.tournament_type IS 'Type of tournament: weekly, special, event';
COMMENT ON COLUMN tournaments.prize_distribution IS 'JSON array of prize tiers (optional, can use default)';

-- ============================================================================
-- TOURNAMENT PARTICIPANTS TABLE (player registrations and scores)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tournament_participants (
  id SERIAL PRIMARY KEY,
  tournament_id VARCHAR(100) NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id VARCHAR(255) NOT NULL,
  player_name VARCHAR(50) DEFAULT 'Pilot',
  
  -- Scores
  best_score INTEGER DEFAULT 0,
  total_games INTEGER DEFAULT 0,
  
  -- Rankings
  final_rank INTEGER,
  prize_won INTEGER DEFAULT 0,
  
  -- Registration
  registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  entry_fee_paid INTEGER DEFAULT 0,
  
  -- Timestamps
  first_game_at TIMESTAMP WITH TIME ZONE,
  last_game_at TIMESTAMP WITH TIME ZONE,
  
  -- Unique constraint: one entry per player per tournament
  CONSTRAINT unique_tournament_player UNIQUE (tournament_id, player_id),
  
  -- Data validation
  CONSTRAINT valid_participant_score CHECK (best_score >= 0),
  CONSTRAINT valid_participant_games CHECK (total_games >= 0),
  CONSTRAINT valid_participant_rank CHECK (final_rank IS NULL OR final_rank > 0),
  CONSTRAINT valid_participant_prize CHECK (prize_won >= 0),
  CONSTRAINT valid_participant_name CHECK (
    LENGTH(player_name) >= 1 AND LENGTH(player_name) <= 50
  )
);

-- Indexes for performance
CREATE INDEX idx_participants_tournament ON tournament_participants(tournament_id);
CREATE INDEX idx_participants_player ON tournament_participants(player_id);
CREATE INDEX idx_participants_score ON tournament_participants(tournament_id, best_score DESC);
CREATE INDEX idx_participants_rank ON tournament_participants(tournament_id, final_rank) 
  WHERE final_rank IS NOT NULL;
CREATE INDEX idx_participants_active ON tournament_participants(tournament_id, last_game_at DESC);

-- Comments
COMMENT ON TABLE tournament_participants IS 'Player registrations and scores for tournaments';
COMMENT ON COLUMN tournament_participants.player_id IS 'Device ID from Flutter';
COMMENT ON COLUMN tournament_participants.best_score IS 'Best score achieved in this tournament';
COMMENT ON COLUMN tournament_participants.final_rank IS 'Final rank when tournament ends (NULL during tournament)';
COMMENT ON COLUMN tournament_participants.prize_won IS 'Coins/gems value won (calculated at end)';

-- ============================================================================
-- TOURNAMENT FUNCTIONS
-- ============================================================================

-- Function: Create a new weekly tournament
CREATE OR REPLACE FUNCTION create_weekly_tournament(
  p_name VARCHAR(200),
  p_prize_pool INTEGER,
  p_start_offset_hours INTEGER DEFAULT 0
)
RETURNS VARCHAR(100)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tournament_id VARCHAR(100);
  v_tournament_name VARCHAR(200);
  v_start_date TIMESTAMP WITH TIME ZONE;
  v_end_date TIMESTAMP WITH TIME ZONE;
  v_year INTEGER;
  v_week INTEGER;
BEGIN
  -- Calculate next Monday 00:00 UTC
  v_start_date = date_trunc('week', NOW() + INTERVAL '1 week') + INTERVAL '0 hours';
  v_start_date = v_start_date + (p_start_offset_hours || ' hours')::INTERVAL;
  
  -- End date: Following Sunday 23:59 UTC
  v_end_date = v_start_date + INTERVAL '6 days 23 hours 59 minutes';
  
  -- Generate tournament ID (format: tournament_YYYY_wWW)
  v_year = EXTRACT(YEAR FROM v_start_date);
  v_week = EXTRACT(WEEK FROM v_start_date);
  v_tournament_id = 'tournament_' || v_year || '_w' || LPAD(v_week::TEXT, 2, '0');
  
  -- Generate tournament name if not provided
  IF p_name IS NULL THEN
    v_tournament_name = 'Weekly Championship ' || v_year || ' W' || v_week;
  ELSE
    v_tournament_name = p_name;
  END IF;
  
  -- Check if tournament already exists
  IF EXISTS (SELECT 1 FROM tournaments WHERE id = v_tournament_id) THEN
    RAISE EXCEPTION 'Tournament % already exists', v_tournament_id;
  END IF;
  
  -- Create tournament
  INSERT INTO tournaments (
    id,
    name,
    description,
    tournament_type,
    status,
    start_date,
    end_date,
    registration_start,
    registration_end,
    max_participants,
    entry_fee,
    prize_pool,
    game_mode,
    min_score_required
  ) VALUES (
    v_tournament_id,
    v_tournament_name,
    'Weekly tournament for all players. Top 50 win prizes!',
    'weekly',
    'upcoming',
    v_start_date,
    v_end_date,
    v_start_date - INTERVAL '1 day', -- Registration opens 1 day before
    v_end_date,
    10000,
    0, -- Free entry
    p_prize_pool,
    'endless',
    0 -- No minimum score required
  );
  
  RAISE NOTICE 'Created tournament: % (% to %)', v_tournament_id, v_start_date, v_end_date;
  
  RETURN v_tournament_id;
END;
$$;

COMMENT ON FUNCTION create_weekly_tournament IS 'Create a new weekly tournament starting next Monday';

-- Function: Update tournament status based on current time
CREATE OR REPLACE FUNCTION update_tournament_statuses()
RETURNS TABLE (
  tournament_id VARCHAR(100),
  old_status VARCHAR(20),
  new_status VARCHAR(20)
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH updates AS (
    UPDATE tournaments
    SET 
      status = CASE
        WHEN status = 'upcoming' AND NOW() >= start_date AND NOW() < end_date THEN 'active'
        WHEN status = 'active' AND NOW() >= end_date THEN 'ended'
        ELSE status
      END,
      started_at = CASE 
        WHEN status = 'upcoming' AND NOW() >= start_date THEN NOW()
        ELSE started_at
      END,
      ended_at = CASE
        WHEN status = 'active' AND NOW() >= end_date THEN NOW()
        ELSE ended_at
      END,
      updated_at = NOW()
    WHERE 
      (status = 'upcoming' AND NOW() >= start_date)
      OR (status = 'active' AND NOW() >= end_date)
    RETURNING 
      id,
      status as prev_status,
      CASE
        WHEN status = 'upcoming' AND NOW() >= start_date AND NOW() < end_date THEN 'active'
        WHEN status = 'active' AND NOW() >= end_date THEN 'ended'
        ELSE status
      END as current_status
  )
  SELECT id, prev_status, current_status FROM updates;
END;
$$;

COMMENT ON FUNCTION update_tournament_statuses IS 'Update tournament statuses based on current time';

-- Function: Get current active tournament
CREATE OR REPLACE FUNCTION get_current_tournament()
RETURNS TABLE (
  id VARCHAR(100),
  name VARCHAR(200),
  status VARCHAR(20),
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  participant_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.name,
    t.status,
    t.start_date,
    t.end_date,
    COUNT(DISTINCT tp.player_id) as participant_count
  FROM tournaments t
  LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
  WHERE t.status IN ('active', 'upcoming')
  GROUP BY t.id, t.name, t.status, t.start_date, t.end_date
  ORDER BY 
    CASE t.status 
      WHEN 'active' THEN 1 
      WHEN 'upcoming' THEN 2 
      ELSE 3 
    END,
    t.start_date ASC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION get_current_tournament IS 'Get the current active or next upcoming tournament';

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Tournament summary with participant counts
CREATE OR REPLACE VIEW v_tournament_summary AS
SELECT 
  t.id,
  t.name,
  t.status,
  t.tournament_type,
  t.start_date,
  t.end_date,
  t.prize_pool,
  COUNT(DISTINCT tp.player_id) as total_participants,
  COUNT(DISTINCT tp.player_id) FILTER (WHERE tp.best_score > 0) as active_participants,
  MAX(tp.best_score) as highest_score,
  AVG(tp.best_score) FILTER (WHERE tp.best_score > 0) as average_score,
  t.created_at,
  t.started_at,
  t.ended_at
FROM tournaments t
LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
GROUP BY t.id, t.name, t.status, t.tournament_type, t.start_date, t.end_date, 
         t.prize_pool, t.created_at, t.started_at, t.ended_at;

COMMENT ON VIEW v_tournament_summary IS 'Tournament overview with participant statistics';

-- ============================================================================
-- INITIAL DATA (Create first tournament if none exist)
-- ============================================================================

DO $$
DECLARE
  v_tournament_count INTEGER;
  v_new_tournament_id VARCHAR(100);
BEGIN
  -- Check if any tournaments exist
  SELECT COUNT(*) INTO v_tournament_count FROM tournaments;
  
  IF v_tournament_count = 0 THEN
    RAISE NOTICE '🏆 No tournaments found, creating first tournament...';
    
    -- Create first tournament
    v_new_tournament_id := create_weekly_tournament(
      NULL,  -- name (auto-generated)
      1000,  -- prize pool
      0      -- start offset
    );
    
    RAISE NOTICE '🏆 ✅ Created first tournament: %', v_new_tournament_id;
  ELSE
    RAISE NOTICE '🏆 Found % existing tournament(s)', v_tournament_count;
  END IF;
END $$;

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournaments') THEN
    RAISE EXCEPTION 'Migration failed: tournaments table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_participants') THEN
    RAISE EXCEPTION 'Migration failed: tournament_participants table not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'create_weekly_tournament'
  ) THEN
    RAISE EXCEPTION 'Migration failed: create_weekly_tournament function not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_tournament_statuses'
  ) THEN
    RAISE EXCEPTION 'Migration failed: update_tournament_statuses function not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'get_current_tournament'
  ) THEN
    RAISE EXCEPTION 'Migration failed: get_current_tournament function not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 008_tournaments_schema.sql completed successfully';
END $$;

