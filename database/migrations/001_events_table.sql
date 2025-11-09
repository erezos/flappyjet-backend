-- ============================================================================
-- MIGRATION: 001_events_table.sql
-- Purpose: Create events table for event-driven architecture
-- Date: 2025-11-09
-- Author: FlappyJet Backend Team
-- ============================================================================

-- Raw events storage from Flutter app
-- Stores all 28 event types with JSONB payload
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  user_id VARCHAR(255) NOT NULL,  -- Device ID from Flutter (DeviceIdentityManager)
  payload JSONB NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_attempts INT DEFAULT 0,
  processing_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Primary query patterns:
-- 1. Get unprocessed events by type (for aggregation cron jobs)
-- 2. Get events for specific user (for analytics)
-- 3. Get events in time range (for tournament calculations)
-- 4. Query payload fields (for dashboard queries)

-- Index: Find unprocessed events by type
-- Used by: LeaderboardAggregator, AnalyticsAggregator
CREATE INDEX idx_events_type_unprocessed ON events(event_type, received_at DESC) 
WHERE processed_at IS NULL;

-- Index: Get all events by type (for analytics)
CREATE INDEX idx_events_type ON events(event_type, received_at DESC);

-- Index: Get events by user (for user analytics)
CREATE INDEX idx_events_user ON events(user_id, received_at DESC);

-- Index: Get events in time range (for tournament calculations)
CREATE INDEX idx_events_received ON events(received_at DESC);

-- Index: Find unprocessed events (for monitoring)
CREATE INDEX idx_events_unprocessed ON events(processed_at) 
WHERE processed_at IS NULL;

-- Index: Query payload fields using GIN index (for dashboard queries)
-- Enables queries like: WHERE payload->>'game_mode' = 'endless'
CREATE INDEX idx_events_payload ON events USING GIN (payload);

-- Index: Composite for tournament event processing
-- Used by: TournamentLeaderboardAggregator
CREATE INDEX idx_events_tournament ON events(event_type, received_at, processed_at)
WHERE event_type = 'game_ended';

-- ============================================================================
-- CONSTRAINTS
-- ============================================================================

-- Ensure event_type is one of the 28 valid types
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    -- User Lifecycle (5 events)
    'app_installed',
    'app_launched',
    'user_registered',
    'settings_changed',
    'app_uninstalled',
    
    -- Game Session (8 events)
    'game_started',
    'game_ended',
    'game_paused',
    'game_resumed',
    'continue_used',
    'level_started',
    'level_completed',
    'level_failed',
    
    -- Economy (4 events)
    'currency_earned',
    'currency_spent',
    'purchase_initiated',
    'purchase_completed',
    
    -- Progression (6 events)
    'skin_unlocked',
    'skin_equipped',
    'achievement_unlocked',
    'mission_completed',
    'daily_streak_claimed',
    'level_unlocked',
    
    -- Social & Engagement (5 events)
    'leaderboard_viewed',
    'tournament_entered',
    'ad_watched',
    'share_clicked',
    'notification_received'
  )
);

-- Ensure user_id is not empty
ALTER TABLE events ADD CONSTRAINT valid_user_id CHECK (
  LENGTH(user_id) > 0
);

-- Ensure payload is valid JSON object
ALTER TABLE events ADD CONSTRAINT valid_payload CHECK (
  jsonb_typeof(payload) = 'object'
);

-- Ensure processing_attempts is non-negative
ALTER TABLE events ADD CONSTRAINT valid_attempts CHECK (
  processing_attempts >= 0
);

-- ============================================================================
-- HELPER TABLE: Track which events have been processed for tournaments
-- ============================================================================

-- This prevents double-counting events when tournament period overlaps with cron runs
CREATE TABLE IF NOT EXISTS tournament_events (
  tournament_id VARCHAR(100) NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (tournament_id, event_id)
);

CREATE INDEX idx_tournament_events_tournament ON tournament_events(tournament_id);
CREATE INDEX idx_tournament_events_event ON tournament_events(event_id);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE events IS 'Raw events from Flutter app (event-driven architecture)';
COMMENT ON COLUMN events.id IS 'Unique event identifier (UUID)';
COMMENT ON COLUMN events.event_type IS 'Event type (one of 28 valid types from Flutter EventBus)';
COMMENT ON COLUMN events.user_id IS 'Device ID from Flutter DeviceIdentityManager';
COMMENT ON COLUMN events.payload IS 'Event payload as JSONB (validated by EventProcessor)';
COMMENT ON COLUMN events.received_at IS 'When backend received the event';
COMMENT ON COLUMN events.processed_at IS 'When event was processed by aggregators (NULL = unprocessed)';
COMMENT ON COLUMN events.processing_attempts IS 'Number of processing attempts (for retry logic)';
COMMENT ON COLUMN events.processing_error IS 'Last processing error (for debugging)';

COMMENT ON TABLE tournament_events IS 'Track which events have been processed for each tournament';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

-- Check table exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    RAISE EXCEPTION 'Migration failed: events table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_events') THEN
    RAISE EXCEPTION 'Migration failed: tournament_events table not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 001_events_table.sql completed successfully';
END $$;

