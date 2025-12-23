-- ============================================================================
-- MIGRATION: 025_partition_events_table_weekly.sql
-- Purpose: Convert events table to weekly partitioned table
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- 
-- IMPORTANT: This migration converts events table to weekly partitioned table
-- Existing data will be automatically migrated to partitions
-- ============================================================================

-- Step 1: Create new partitioned table structure
-- We'll create a new table and migrate data, then rename

CREATE TABLE IF NOT EXISTS events_partitioned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  campaign_id VARCHAR(255), -- ✅ NEW: Campaign ID column (from migration 021)
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_attempts INT DEFAULT 0,
  processing_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_event_type CHECK (
    event_type IN (
      'app_installed', 'app_launched', 'user_registered', 'settings_changed', 'app_uninstalled',
      'user_installed', 'user_acquired', -- ✅ NEW: Added new event types
      'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used',
      'level_started', 'level_completed', 'level_failed',
      'currency_earned', 'currency_spent', 'purchase_initiated', 'purchase_completed',
      'skin_unlocked', 'skin_equipped', 'achievement_unlocked', 'mission_completed',
      'daily_streak_claimed', 'level_unlocked',
      'leaderboard_viewed', 'tournament_entered', 'ad_watched', 'share_clicked',
      'notification_received', 'bonus_collected', -- ✅ NEW: Added bonus_collected
      'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage', -- ✅ NEW: Performance events
      'app_crashed', 'app_error' -- ✅ NEW: Crash/error events
    )
  ),
  CONSTRAINT valid_user_id CHECK (LENGTH(user_id) > 0),
  CONSTRAINT valid_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT valid_attempts CHECK (processing_attempts >= 0),
  CONSTRAINT valid_platform CHECK (campaign_id IS NULL OR LENGTH(campaign_id) > 0)
) PARTITION BY RANGE (received_at);

-- Step 2: Create function to generate weekly partition name
CREATE OR REPLACE FUNCTION get_weekly_partition_name(week_start DATE)
RETURNS TEXT AS $$
BEGIN
  RETURN 'events_week_' || TO_CHAR(week_start, 'YYYY_MM_DD');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Create function to create weekly partition
CREATE OR REPLACE FUNCTION create_weekly_partition(week_start DATE)
RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  week_end DATE;
BEGIN
  partition_name := get_weekly_partition_name(week_start);
  week_end := week_start + INTERVAL '7 days';
  
  -- Create partition if it doesn't exist
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I PARTITION OF events_partitioned
    FOR VALUES FROM (%L) TO (%L)
  ', partition_name, week_start, week_end);
  
  RAISE NOTICE 'Created partition: %', partition_name;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create partitions for current week + next 12 weeks (3 months ahead)
DO $$
DECLARE
  current_week_start DATE;
  week_offset INT;
BEGIN
  -- Get start of current week (Monday)
  current_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
  
  -- Create partitions for current week and next 12 weeks
  FOR week_offset IN 0..12 LOOP
    PERFORM create_weekly_partition(current_week_start + (week_offset * INTERVAL '7 days'));
  END LOOP;
  
  RAISE NOTICE '✅ Created 13 weekly partitions (current week + 12 weeks ahead)';
END $$;

-- Step 5: Create indexes on partitioned table (applies to all partitions)
-- Note: Indexes on partitioned tables are automatically created on all partitions

-- Time-based index (most important for partition pruning)
CREATE INDEX IF NOT EXISTS idx_events_partitioned_received 
  ON events_partitioned(received_at DESC);

-- Event type index
CREATE INDEX IF NOT EXISTS idx_events_partitioned_type 
  ON events_partitioned(event_type, received_at DESC);

-- User index
CREATE INDEX IF NOT EXISTS idx_events_partitioned_user 
  ON events_partitioned(user_id, received_at DESC);

-- Campaign index (for ROI analysis)
CREATE INDEX IF NOT EXISTS idx_events_partitioned_campaign_received 
  ON events_partitioned(campaign_id, received_at DESC) 
  WHERE campaign_id IS NOT NULL;

-- Composite index for campaign analytics
CREATE INDEX IF NOT EXISTS idx_events_partitioned_type_received_campaign 
  ON events_partitioned(event_type, received_at DESC, campaign_id) 
  WHERE campaign_id IS NOT NULL;

-- GIN index for JSONB payload queries
CREATE INDEX IF NOT EXISTS idx_events_partitioned_payload 
  ON events_partitioned USING GIN (payload);

-- Unprocessed events index
CREATE INDEX IF NOT EXISTS idx_events_partitioned_type_unprocessed 
  ON events_partitioned(event_type, received_at DESC) 
  WHERE processed_at IS NULL;

-- Tournament events index
CREATE INDEX IF NOT EXISTS idx_events_partitioned_tournament 
  ON events_partitioned(event_type, received_at, processed_at)
  WHERE event_type = 'game_ended';

-- Step 6: Migrate existing data (if events table exists and has data)
DO $$
DECLARE
  row_count BIGINT;
BEGIN
  -- Check if old events table exists and has data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    SELECT COUNT(*) INTO row_count FROM events;
    
    IF row_count > 0 THEN
      RAISE NOTICE 'Migrating % rows from events to events_partitioned...', row_count;
      
      -- Migrate data in batches (to avoid long locks)
      -- This will automatically route to correct partitions based on received_at
      INSERT INTO events_partitioned (
        id, event_type, user_id, payload, campaign_id, received_at, 
        processed_at, processing_attempts, processing_error, created_at
      )
      SELECT 
        id, event_type, user_id, payload, 
        payload->>'campaign_id' as campaign_id, -- Extract campaign_id from payload
        received_at, processed_at, processing_attempts, processing_error, created_at
      FROM events
      ORDER BY received_at
      ON CONFLICT (id) DO NOTHING; -- Skip duplicates if any
      
      RAISE NOTICE '✅ Data migration completed';
    ELSE
      RAISE NOTICE 'Events table exists but is empty, skipping migration';
    END IF;
  ELSE
    RAISE NOTICE 'Events table does not exist, skipping migration';
  END IF;
END $$;

-- Step 7: Rename tables (swap old and new)
DO $$
BEGIN
  -- Rename old table to backup
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    ALTER TABLE events RENAME TO events_backup;
    RAISE NOTICE 'Renamed events to events_backup';
  END IF;
  
  -- Rename new partitioned table to events
  ALTER TABLE events_partitioned RENAME TO events;
  RAISE NOTICE 'Renamed events_partitioned to events';
END $$;

-- Step 8: Update foreign key references (if any)
-- Note: tournament_events table references events(id)
-- This should work automatically since we're keeping the same id column

-- Step 9: Create partition maintenance function
CREATE OR REPLACE FUNCTION maintain_weekly_partitions()
RETURNS VOID AS $$
DECLARE
  current_week_start DATE;
  oldest_week_start DATE;
  week_offset INT;
  partition_name TEXT;
  week_end DATE;
BEGIN
  -- Get start of current week (Monday)
  current_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
  
  -- Create partitions for next 12 weeks (if they don't exist)
  FOR week_offset IN 0..12 LOOP
    PERFORM create_weekly_partition(current_week_start + (week_offset * INTERVAL '7 days'));
  END LOOP;
  
  -- Drop partitions older than 12 months (52 weeks)
  oldest_week_start := current_week_start - INTERVAL '52 weeks';
  
  -- Find and drop old partitions
  FOR partition_name IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename LIKE 'events_week_%'
      AND tablename < get_weekly_partition_name(oldest_week_start)
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', partition_name);
    RAISE NOTICE 'Dropped old partition: %', partition_name;
  END LOOP;
  
  RAISE NOTICE '✅ Partition maintenance completed';
END;
$$ LANGUAGE plpgsql;

-- Step 10: Create comment
COMMENT ON FUNCTION maintain_weekly_partitions() IS 
  'Maintains weekly partitions: creates future partitions and drops old ones (>12 months)';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  -- Check that events table exists and is partitioned
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' 
      AND c.relname = 'events'
      AND c.relkind = 'p' -- 'p' = partitioned table
  ) THEN
    RAISE EXCEPTION 'Migration failed: events table is not partitioned';
  END IF;
  
  -- Check that at least one partition exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_inherits
    WHERE inhparent = 'events'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration failed: No partitions found for events table';
  END IF;
  
  RAISE NOTICE '✅ Migration 025_partition_events_table_weekly.sql completed successfully';
  RAISE NOTICE '📊 Events table is now partitioned by week';
  RAISE NOTICE '📊 Run maintain_weekly_partitions() weekly (via cron) to create future partitions';
END $$;

