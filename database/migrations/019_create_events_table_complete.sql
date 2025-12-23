-- ============================================================================
-- MIGRATION: 019_create_events_table_complete.sql
-- Purpose: Create events table with all required fields for analytics dashboard
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- 
-- This migration creates the events table that should have been created by
-- migration 001, but includes all updates from migrations 020-025:
-- - Base structure from 001_events_table.sql
-- - campaign_id column from 021_add_campaign_id_to_events.sql
-- - All constraints and indexes needed for analytics
-- 
-- IMPORTANT: This table will be partitioned in migration 025
-- ============================================================================

-- ============================================================================
-- EVENTS TABLE
-- ============================================================================

-- Raw events storage from Flutter app
-- Stores all event types with JSONB payload
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  user_id VARCHAR(255) NOT NULL,  -- Device ID from Flutter (DeviceIdentityManager)
  payload JSONB NOT NULL,
  campaign_id VARCHAR(255), -- ✅ From migration 021: Campaign ID for ROI analysis
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_attempts INT DEFAULT 0,
  processing_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- CONSTRAINTS
-- ============================================================================

-- Drop existing constraints if they exist (safe for re-running)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_event_type' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_event_type;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_user_id' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_payload' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_payload;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_attempts' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_attempts;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_campaign_id' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_campaign_id;
  END IF;
END $$;

-- Ensure event_type is one of the valid types (includes new types from migrations 020-025)
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    -- User Lifecycle (5 events)
    'app_installed',
    'app_launched',
    'user_registered',
    'settings_changed',
    'app_uninstalled',
    
    -- User Acquisition (2 events) - ✅ NEW from migration 020
    'user_installed',
    'user_acquired',
    
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
    'notification_received',
    
    -- Bonus & Engagement (1 event) - ✅ NEW from migration 025
    'bonus_collected',
    
    -- Performance Events (4 events) - ✅ NEW from migration 023
    'performance_metrics',
    'app_load_time',
    'game_load_time',
    'memory_usage',
    
    -- Crash/Error Events (2 events) - ✅ NEW from migration 024
    'app_crashed',
    'app_error'
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

-- Ensure campaign_id is valid if provided
ALTER TABLE events ADD CONSTRAINT valid_campaign_id CHECK (
  campaign_id IS NULL OR LENGTH(campaign_id) > 0
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Primary query patterns:
-- 1. Get unprocessed events by type (for aggregation cron jobs)
-- 2. Get events for specific user (for analytics)
-- 3. Get events in time range (for tournament calculations)
-- 4. Query payload fields (for dashboard queries)
-- 5. Campaign-based queries (for ROI analysis)

-- Index: Find unprocessed events by type
-- Used by: LeaderboardAggregator, AnalyticsAggregator
CREATE INDEX IF NOT EXISTS idx_events_type_unprocessed 
  ON events(event_type, received_at DESC) 
  WHERE processed_at IS NULL;

-- Index: Get all events by type (for analytics)
CREATE INDEX IF NOT EXISTS idx_events_type 
  ON events(event_type, received_at DESC);

-- Index: Get events by user (for user analytics)
CREATE INDEX IF NOT EXISTS idx_events_user 
  ON events(user_id, received_at DESC);

-- Index: Get events in time range (for tournament calculations)
CREATE INDEX IF NOT EXISTS idx_events_received 
  ON events(received_at DESC);

-- Index: Find unprocessed events (for monitoring)
CREATE INDEX IF NOT EXISTS idx_events_unprocessed 
  ON events(processed_at) 
  WHERE processed_at IS NULL;

-- Index: Query payload fields using GIN index (for dashboard queries)
-- Enables queries like: WHERE payload->>'game_mode' = 'endless'
CREATE INDEX IF NOT EXISTS idx_events_payload 
  ON events USING GIN (payload);

-- Index: Composite for tournament event processing
-- Used by: TournamentLeaderboardAggregator
CREATE INDEX IF NOT EXISTS idx_events_tournament 
  ON events(event_type, received_at, processed_at)
  WHERE event_type = 'game_ended';

-- Index: Campaign queries (for ROI analysis) - ✅ From migration 021
CREATE INDEX IF NOT EXISTS idx_events_campaign_timestamp 
  ON events(campaign_id, received_at DESC) 
  WHERE campaign_id IS NOT NULL;

-- Index: Composite for campaign analytics queries - ✅ From migration 021
CREATE INDEX IF NOT EXISTS idx_events_type_received_campaign 
  ON events(event_type, received_at DESC, campaign_id) 
  WHERE campaign_id IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE events IS 'Raw events from Flutter app (event-driven architecture) - ready for partitioning';
COMMENT ON COLUMN events.id IS 'Unique event identifier (UUID)';
COMMENT ON COLUMN events.event_type IS 'Event type (one of 33 valid types from Flutter EventBus)';
COMMENT ON COLUMN events.user_id IS 'Device ID from Flutter DeviceIdentityManager';
COMMENT ON COLUMN events.payload IS 'Event payload as JSONB (entire event object stored here)';
COMMENT ON COLUMN events.campaign_id IS 'Campaign ID from payload (extracted for faster ROI queries)';
COMMENT ON COLUMN events.received_at IS 'When backend received the event';
COMMENT ON COLUMN events.processed_at IS 'When event was processed by aggregators (NULL = unprocessed)';
COMMENT ON COLUMN events.processing_attempts IS 'Number of processing attempts (for retry logic)';
COMMENT ON COLUMN events.processing_error IS 'Last processing error (for debugging)';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  -- Check table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    RAISE EXCEPTION 'Migration failed: events table not created';
  END IF;
  
  -- Check campaign_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'campaign_id'
  ) THEN
    RAISE EXCEPTION 'Migration failed: campaign_id column not created';
  END IF;
  
  -- Check key indexes exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_events_received') THEN
    RAISE EXCEPTION 'Migration failed: idx_events_received index not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_events_campaign_timestamp') THEN
    RAISE EXCEPTION 'Migration failed: idx_events_campaign_timestamp index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 019_create_events_table_complete.sql completed successfully';
  RAISE NOTICE '📊 Events table created with all required fields for analytics dashboard';
  RAISE NOTICE '📊 Ready for partitioning in migration 025';
END $$;

