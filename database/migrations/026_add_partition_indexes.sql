-- ============================================================================
-- MIGRATION: 026_add_partition_indexes.sql
-- Purpose: Add comprehensive indexes for partitioned events table and new tables
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- 
-- Note: Indexes on partitioned tables are automatically created on all partitions
-- This migration adds indexes that were missing or needed for new analytics queries
-- ============================================================================

-- ============================================================================
-- INDEXES FOR PARTITIONED EVENTS TABLE
-- ============================================================================

-- ✅ These indexes are already created in migration 025, but we verify they exist
-- If events table is not yet partitioned, these will be created on the regular table

-- Campaign + time index (for ROI analysis)
-- This enables fast queries like: WHERE campaign_id = X AND received_at >= Y
CREATE INDEX IF NOT EXISTS idx_events_campaign_received 
  ON events(campaign_id, received_at DESC) 
  WHERE campaign_id IS NOT NULL;

-- Revenue events index (for monetization analytics)
-- Enables fast queries for revenue events by time
CREATE INDEX IF NOT EXISTS idx_events_revenue_received 
  ON events(event_type, received_at DESC) 
  WHERE event_type IN ('ad_revenue', 'purchase_completed');

-- Composite index for campaign analytics (event type + time + campaign)
CREATE INDEX IF NOT EXISTS idx_events_type_received_campaign 
  ON events(event_type, received_at DESC, campaign_id) 
  WHERE campaign_id IS NOT NULL;

-- ============================================================================
-- VERIFY EXISTING INDEXES ON EVENTS TABLE
-- ============================================================================

-- Note: These indexes should already exist from migration 001 or 025
-- We verify they exist, but don't recreate them (CREATE INDEX IF NOT EXISTS is safe)

-- Time-based index (critical for partition pruning)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_events_received' 
      OR indexname = 'idx_events_partitioned_received'
  ) THEN
    CREATE INDEX idx_events_received ON events(received_at DESC);
    RAISE NOTICE 'Created idx_events_received';
  END IF;
END $$;

-- Event type index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_events_type' 
      OR indexname = 'idx_events_partitioned_type'
  ) THEN
    CREATE INDEX idx_events_type ON events(event_type, received_at DESC);
    RAISE NOTICE 'Created idx_events_type';
  END IF;
END $$;

-- User index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_events_user' 
      OR indexname = 'idx_events_partitioned_user'
  ) THEN
    CREATE INDEX idx_events_user ON events(user_id, received_at DESC);
    RAISE NOTICE 'Created idx_events_user';
  END IF;
END $$;

-- GIN index for JSONB payload
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_events_payload' 
      OR indexname = 'idx_events_partitioned_payload'
  ) THEN
    CREATE INDEX idx_events_payload ON events USING GIN (payload);
    RAISE NOTICE 'Created idx_events_payload';
  END IF;
END $$;

-- ============================================================================
-- INDEXES FOR USER_ACQUISITIONS TABLE
-- ============================================================================

-- Note: These should already exist from migration 020, but we verify

-- Campaign ID index (for ROI analysis)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_user_acquisitions_campaign_id'
  ) THEN
    CREATE INDEX idx_user_acquisitions_campaign_id 
      ON user_acquisitions(campaign_id) 
      WHERE campaign_id IS NOT NULL;
    RAISE NOTICE 'Created idx_user_acquisitions_campaign_id';
  END IF;
END $$;

-- Install date index (for date-based cohorts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_user_acquisitions_install_date'
  ) THEN
    CREATE INDEX idx_user_acquisitions_install_date 
      ON user_acquisitions(install_date DESC);
    RAISE NOTICE 'Created idx_user_acquisitions_install_date';
  END IF;
END $$;

-- Campaign + date composite (for campaign cohorts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_user_acquisitions_campaign_date'
  ) THEN
    CREATE INDEX idx_user_acquisitions_campaign_date 
      ON user_acquisitions(campaign_id, install_date DESC) 
      WHERE campaign_id IS NOT NULL;
    RAISE NOTICE 'Created idx_user_acquisitions_campaign_date';
  END IF;
END $$;

-- ============================================================================
-- INDEXES FOR CAMPAIGN_COSTS TABLE
-- ============================================================================

-- Note: These should already exist from migration 022, but we verify

-- Campaign + date index (UNIQUE constraint already covers this, but we verify)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_campaign_costs_campaign_date'
  ) THEN
    CREATE INDEX idx_campaign_costs_campaign_date 
      ON campaign_costs(campaign_id, date DESC);
    RAISE NOTICE 'Created idx_campaign_costs_campaign_date';
  END IF;
END $$;

-- Date range index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_campaign_costs_date'
  ) THEN
    CREATE INDEX idx_campaign_costs_date 
      ON campaign_costs(date DESC);
    RAISE NOTICE 'Created idx_campaign_costs_date';
  END IF;
END $$;

-- ============================================================================
-- INDEXES FOR PERFORMANCE_METRICS TABLE
-- ============================================================================

-- Note: These should already exist from migration 023, but we verify

-- Timestamp index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_timestamp'
  ) THEN
    CREATE INDEX idx_performance_metrics_timestamp 
      ON performance_metrics(timestamp DESC);
    RAISE NOTICE 'Created idx_performance_metrics_timestamp';
  END IF;
END $$;

-- User + timestamp index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_user_timestamp'
  ) THEN
    CREATE INDEX idx_performance_metrics_user_timestamp 
      ON performance_metrics(user_id, timestamp DESC);
    RAISE NOTICE 'Created idx_performance_metrics_user_timestamp';
  END IF;
END $$;

-- FPS analysis index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_fps'
  ) THEN
    CREATE INDEX idx_performance_metrics_fps 
      ON performance_metrics(fps_average, timestamp DESC) 
      WHERE fps_average IS NOT NULL;
    RAISE NOTICE 'Created idx_performance_metrics_fps';
  END IF;
END $$;

-- ============================================================================
-- INDEXES FOR CRASH_LOGS TABLE
-- ============================================================================

-- Note: These should already exist from migration 024, but we verify

-- Timestamp index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_crash_logs_timestamp'
  ) THEN
    CREATE INDEX idx_crash_logs_timestamp 
      ON crash_logs(timestamp DESC);
    RAISE NOTICE 'Created idx_crash_logs_timestamp';
  END IF;
END $$;

-- Crash type index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_crash_logs_crash_type'
  ) THEN
    CREATE INDEX idx_crash_logs_crash_type 
      ON crash_logs(crash_type, timestamp DESC);
    RAISE NOTICE 'Created idx_crash_logs_crash_type';
  END IF;
END $$;

-- User + timestamp index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_crash_logs_user_timestamp'
  ) THEN
    CREATE INDEX idx_crash_logs_user_timestamp 
      ON crash_logs(user_id, timestamp DESC);
    RAISE NOTICE 'Created idx_crash_logs_user_timestamp';
  END IF;
END $$;

-- ============================================================================
-- ANALYZE TABLES FOR QUERY PLANNER
-- ============================================================================

-- Update query planner statistics for better query performance
ANALYZE events;
ANALYZE user_acquisitions;
ANALYZE campaign_costs;
ANALYZE performance_metrics;
ANALYZE crash_logs;

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
DECLARE
  index_count INT;
BEGIN
  -- Count indexes on events table
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE tablename = 'events' AND schemaname = 'public';
  
  IF index_count < 5 THEN
    RAISE WARNING 'Events table has fewer indexes than expected: %', index_count;
  END IF;
  
  RAISE NOTICE '✅ Migration 026_add_partition_indexes.sql completed successfully';
  RAISE NOTICE '📊 Events table has % indexes', index_count;
END $$;

