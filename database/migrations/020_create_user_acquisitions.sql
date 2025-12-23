-- ============================================================================
-- MIGRATION: 020_create_user_acquisitions.sql
-- Purpose: Create user_acquisitions table for campaign attribution tracking
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- User Acquisitions Table
-- Stores campaign attribution data for each user install
-- Enables ROI analysis by linking users to their acquisition campaigns
CREATE TABLE IF NOT EXISTS user_acquisitions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  install_date TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Campaign Attribution Fields
  source VARCHAR(50),              -- "google", "organic", "referral", "facebook", etc.
  medium VARCHAR(50),               -- "cpc", "organic", "referral", "social", etc.
  campaign VARCHAR(255),            -- Campaign name (e.g., "summer_sale_2025")
  campaign_id VARCHAR(255),         -- Google Ads campaign ID (primary identifier)
  ad_group VARCHAR(255),            -- Ad group name
  ad_group_id VARCHAR(255),         -- Ad group ID
  keyword VARCHAR(255),             -- Search keyword (if search campaign)
  gclid VARCHAR(255),               -- Google Click ID (unique click identifier)
  creative VARCHAR(255),            -- Ad creative identifier
  
  -- Platform & Location
  platform VARCHAR(10) NOT NULL,   -- "ios" or "android"
  country VARCHAR(2),               -- ISO country code (from IP geolocation)
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_platform CHECK (platform IN ('ios', 'android')),
  CONSTRAINT valid_country CHECK (country IS NULL OR LENGTH(country) = 2)
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index: Campaign queries (most common for ROI analysis)
CREATE INDEX IF NOT EXISTS idx_user_acquisitions_campaign_id 
  ON user_acquisitions(campaign_id) 
  WHERE campaign_id IS NOT NULL;

-- Index: Install date queries (for date-based cohorts)
CREATE INDEX IF NOT EXISTS idx_user_acquisitions_install_date 
  ON user_acquisitions(install_date DESC);

-- Index: Source/medium queries (for acquisition channel analysis)
CREATE INDEX IF NOT EXISTS idx_user_acquisitions_source_medium 
  ON user_acquisitions(source, medium) 
  WHERE source IS NOT NULL AND medium IS NOT NULL;

-- Index: Campaign + date composite (for campaign cohort analysis)
CREATE INDEX IF NOT EXISTS idx_user_acquisitions_campaign_date 
  ON user_acquisitions(campaign_id, install_date DESC) 
  WHERE campaign_id IS NOT NULL;

-- Index: Platform queries (for platform-specific analysis)
CREATE INDEX IF NOT EXISTS idx_user_acquisitions_platform 
  ON user_acquisitions(platform, install_date DESC);

-- Index: Country queries (for geographic analysis)
CREATE INDEX IF NOT EXISTS idx_user_acquisitions_country 
  ON user_acquisitions(country, install_date DESC) 
  WHERE country IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE user_acquisitions IS 'Campaign attribution data for each user install - enables ROI analysis';
COMMENT ON COLUMN user_acquisitions.user_id IS 'Device ID from Flutter (matches events.user_id)';
COMMENT ON COLUMN user_acquisitions.install_date IS 'When user first installed the app';
COMMENT ON COLUMN user_acquisitions.campaign_id IS 'Google Ads campaign ID (primary identifier for ROI analysis)';
COMMENT ON COLUMN user_acquisitions.source IS 'Install source (google, organic, referral, etc.)';
COMMENT ON COLUMN user_acquisitions.medium IS 'Install medium (cpc, organic, referral, etc.)';
COMMENT ON COLUMN user_acquisitions.gclid IS 'Google Click ID (unique click identifier)';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_acquisitions') THEN
    RAISE EXCEPTION 'Migration failed: user_acquisitions table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_user_acquisitions_campaign_id') THEN
    RAISE EXCEPTION 'Migration failed: idx_user_acquisitions_campaign_id index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 020_create_user_acquisitions.sql completed successfully';
END $$;

