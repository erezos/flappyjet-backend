-- ============================================================================
-- MIGRATION: 021_add_campaign_id_to_events.sql
-- Purpose: Add campaign_id column to events table for faster ROI queries
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Add campaign_id column to events table
-- This enables faster queries for campaign-based analytics without joining user_acquisitions
-- Alternative: Can join through user_acquisitions (no schema change needed)
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(255);

-- Create index for campaign queries
CREATE INDEX IF NOT EXISTS idx_events_campaign_timestamp 
  ON events(campaign_id, received_at DESC) 
  WHERE campaign_id IS NOT NULL;

-- Create composite index for campaign analytics queries
CREATE INDEX IF NOT EXISTS idx_events_type_received_campaign 
  ON events(event_type, received_at DESC, campaign_id) 
  WHERE campaign_id IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN events.campaign_id IS 'Campaign ID from user_acquisitions - enables faster ROI queries';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'campaign_id'
  ) THEN
    RAISE EXCEPTION 'Migration failed: campaign_id column not added to events table';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_events_campaign_timestamp') THEN
    RAISE EXCEPTION 'Migration failed: idx_events_campaign_timestamp index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 021_add_campaign_id_to_events.sql completed successfully';
END $$;

