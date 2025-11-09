-- ============================================================================
-- MIGRATION: 003_prizes.sql
-- Purpose: Create prizes table for poll-based prize distribution
-- Date: 2025-11-09
-- Author: FlappyJet Backend Team
-- ============================================================================

-- ============================================================================
-- PRIZES TABLE (poll-based claiming)
-- ============================================================================

-- Stores unclaimed prizes from tournaments
-- Flutter app polls GET /api/v2/prizes/pending to check for prizes
-- When user claims in app, POST /api/v2/prizes/claim marks as claimed
CREATE TABLE IF NOT EXISTS prizes (
  prize_id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  tournament_id VARCHAR(100) NOT NULL,
  tournament_name VARCHAR(100) NOT NULL,
  rank INTEGER NOT NULL,
  coins INTEGER DEFAULT 0,
  gems INTEGER DEFAULT 0,
  awarded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  claimed_at TIMESTAMP WITH TIME ZONE,
  notified_at TIMESTAMP WITH TIME ZONE,  -- When Flutter app was notified
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Primary query pattern: Get unclaimed prizes for user
CREATE INDEX idx_prizes_user_unclaimed ON prizes(user_id, claimed_at) 
WHERE claimed_at IS NULL;

-- Query: Get all prizes for user (history)
CREATE INDEX idx_prizes_user ON prizes(user_id, awarded_at DESC);

-- Query: Get all unclaimed prizes (admin monitoring)
CREATE INDEX idx_prizes_unclaimed ON prizes(claimed_at, awarded_at DESC) 
WHERE claimed_at IS NULL;

-- Query: Get prizes by tournament
CREATE INDEX idx_prizes_tournament ON prizes(tournament_id, rank);

-- Query: Find prizes awarded recently (for notifications)
CREATE INDEX idx_prizes_recent ON prizes(awarded_at DESC) 
WHERE claimed_at IS NULL;

-- ============================================================================
-- CONSTRAINTS
-- ============================================================================

-- Ensure user_id is not empty
ALTER TABLE prizes ADD CONSTRAINT valid_prize_user_id CHECK (
  LENGTH(user_id) > 0
);

-- Ensure tournament_id is not empty
ALTER TABLE prizes ADD CONSTRAINT valid_tournament_id CHECK (
  LENGTH(tournament_id) > 0
);

-- Ensure rank is valid (1-50 for tournaments)
ALTER TABLE prizes ADD CONSTRAINT valid_rank CHECK (
  rank >= 1 AND rank <= 50
);

-- Ensure at least one reward is given
ALTER TABLE prizes ADD CONSTRAINT valid_rewards CHECK (
  coins > 0 OR gems > 0
);

-- Ensure coins and gems are non-negative
ALTER TABLE prizes ADD CONSTRAINT valid_coins CHECK (
  coins >= 0
);

ALTER TABLE prizes ADD CONSTRAINT valid_gems CHECK (
  gems >= 0
);

-- Ensure awarded_at is not in future
ALTER TABLE prizes ADD CONSTRAINT valid_awarded_at CHECK (
  awarded_at <= NOW()
);

-- Ensure claimed_at is after awarded_at (if claimed)
ALTER TABLE prizes ADD CONSTRAINT valid_claimed_at CHECK (
  claimed_at IS NULL OR claimed_at >= awarded_at
);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE prizes IS 'Tournament prizes awarded to players (poll-based claiming system)';
COMMENT ON COLUMN prizes.prize_id IS 'Unique prize identifier (format: prize_{tournament_id}_{user_id}_{timestamp})';
COMMENT ON COLUMN prizes.user_id IS 'Device ID from Flutter';
COMMENT ON COLUMN prizes.tournament_id IS 'Tournament identifier (e.g., tournament_2025_w45)';
COMMENT ON COLUMN prizes.tournament_name IS 'Human-readable tournament name';
COMMENT ON COLUMN prizes.rank IS 'Player rank in tournament (1-50)';
COMMENT ON COLUMN prizes.coins IS 'Coins reward amount';
COMMENT ON COLUMN prizes.gems IS 'Gems reward amount';
COMMENT ON COLUMN prizes.awarded_at IS 'When prize was calculated and created';
COMMENT ON COLUMN prizes.claimed_at IS 'When user claimed prize in Flutter app (NULL = unclaimed)';
COMMENT ON COLUMN prizes.notified_at IS 'When Flutter app was notified of prize';

-- ============================================================================
-- PRIZE DISTRIBUTION REFERENCE (from BACKEND_API_SPECIFICATION.md)
-- ============================================================================

/*
Weekly Tournament Prize Pool:
- Rank 1:      5000 coins + 250 gems
- Rank 2:      3000 coins + 150 gems
- Rank 3:      2000 coins + 100 gems
- Rank 4-10:   1000 coins + 50 gems
- Rank 11-50:   500 coins + 25 gems

Prizes are calculated by PrizeCalculator cron job (Monday 00:05 UTC)
and inserted into this table for polling by Flutter app.
*/

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Unclaimed prizes summary
CREATE OR REPLACE VIEW v_unclaimed_prizes_summary AS
SELECT 
  COUNT(*) as total_unclaimed,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(coins) as total_coins_pending,
  SUM(gems) as total_gems_pending,
  MIN(awarded_at) as oldest_unclaimed,
  MAX(awarded_at) as newest_unclaimed
FROM prizes
WHERE claimed_at IS NULL;

COMMENT ON VIEW v_unclaimed_prizes_summary IS 'Summary of unclaimed prizes for monitoring';

-- View: Prize claim rate by tournament
CREATE OR REPLACE VIEW v_prize_claim_rate AS
SELECT 
  tournament_id,
  tournament_name,
  COUNT(*) as total_prizes,
  COUNT(*) FILTER (WHERE claimed_at IS NOT NULL) as claimed,
  COUNT(*) FILTER (WHERE claimed_at IS NULL) as unclaimed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE claimed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 
    2
  ) as claim_rate_percent,
  AVG(
    EXTRACT(EPOCH FROM (claimed_at - awarded_at)) / 3600
  ) FILTER (WHERE claimed_at IS NOT NULL) as avg_claim_time_hours
FROM prizes
GROUP BY tournament_id, tournament_name
ORDER BY tournament_id DESC;

COMMENT ON VIEW v_prize_claim_rate IS 'Prize claim statistics by tournament';

-- ============================================================================
-- PRIZE EXPIRY (OPTIONAL)
-- ============================================================================

-- Optional: Add expiry logic (e.g., prizes expire after 30 days)
-- Uncomment if you want prizes to expire

-- ALTER TABLE prizes ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE 
--   GENERATED ALWAYS AS (awarded_at + INTERVAL '30 days') STORED;

-- ALTER TABLE prizes ADD CONSTRAINT prize_not_expired CHECK (
--   claimed_at IS NULL OR claimed_at <= expires_at
-- );

-- CREATE INDEX idx_prizes_expiry ON prizes(expires_at) 
-- WHERE claimed_at IS NULL AND expires_at < NOW();

-- ============================================================================
-- PRIZE HISTORY ARCHIVAL (OPTIONAL)
-- ============================================================================

-- Optional: Archive claimed prizes older than 90 days to separate table
-- CREATE TABLE IF NOT EXISTS prizes_archive (
--   LIKE prizes INCLUDING ALL
-- );

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prizes') THEN
    RAISE EXCEPTION 'Migration failed: prizes table not created';
  END IF;
  
  -- Verify indexes
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'prizes' AND indexname = 'idx_prizes_user_unclaimed'
  ) THEN
    RAISE EXCEPTION 'Migration failed: idx_prizes_user_unclaimed index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 003_prizes.sql completed successfully';
END $$;

