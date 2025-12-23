-- ============================================================================
-- MIGRATION: 022_create_campaign_costs.sql
-- Purpose: Create campaign_costs table for Google Ads cost data import
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Campaign Costs Table
-- Stores daily campaign spend from Google Ads API
-- Enables CPI (Cost Per Install) and ROI calculations
CREATE TABLE IF NOT EXISTS campaign_costs (
  id SERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL,
  campaign_name VARCHAR(255),
  date DATE NOT NULL,
  
  -- Cost Data
  cost_usd DECIMAL(10,2) NOT NULL,
  impressions INTEGER,
  clicks INTEGER,
  installs INTEGER,                -- From Google Ads if available
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_cost CHECK (cost_usd >= 0),
  CONSTRAINT valid_impressions CHECK (impressions IS NULL OR impressions >= 0),
  CONSTRAINT valid_clicks CHECK (clicks IS NULL OR clicks >= 0),
  CONSTRAINT valid_installs CHECK (installs IS NULL OR installs >= 0),
  UNIQUE(campaign_id, date) -- One record per campaign per day
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index: Campaign + date queries (most common for ROI analysis)
CREATE INDEX IF NOT EXISTS idx_campaign_costs_campaign_date 
  ON campaign_costs(campaign_id, date DESC);

-- Index: Date range queries (for time-series analysis)
CREATE INDEX IF NOT EXISTS idx_campaign_costs_date 
  ON campaign_costs(date DESC);

-- Index: Campaign name queries (for reporting)
CREATE INDEX IF NOT EXISTS idx_campaign_costs_campaign_name 
  ON campaign_costs(campaign_name, date DESC) 
  WHERE campaign_name IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE campaign_costs IS 'Daily campaign spend from Google Ads API - enables CPI and ROI calculations';
COMMENT ON COLUMN campaign_costs.campaign_id IS 'Google Ads campaign ID (matches user_acquisitions.campaign_id)';
COMMENT ON COLUMN campaign_costs.date IS 'Date of the cost data (one record per campaign per day)';
COMMENT ON COLUMN campaign_costs.cost_usd IS 'Total cost in USD for this campaign on this date';
COMMENT ON COLUMN campaign_costs.installs IS 'Number of installs from Google Ads (if available)';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaign_costs') THEN
    RAISE EXCEPTION 'Migration failed: campaign_costs table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_campaign_costs_campaign_date') THEN
    RAISE EXCEPTION 'Migration failed: idx_campaign_costs_campaign_date index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 022_create_campaign_costs.sql completed successfully';
END $$;

