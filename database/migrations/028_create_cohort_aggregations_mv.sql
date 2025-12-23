-- ============================================================================
-- MIGRATION: 028_create_cohort_aggregations_mv.sql
-- Purpose: Create cohort aggregations materialized view for retention analysis
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Cohort Aggregations Materialized View
-- Pre-aggregates retention and LTV by cohort (install date or campaign)
CREATE MATERIALIZED VIEW IF NOT EXISTS cohort_aggregations AS
WITH cohorts AS (
  SELECT 
    ua.user_id,
    DATE(ua.install_date) as cohort_date,
    ua.campaign_id,
    ua.platform
  FROM user_acquisitions ua
),
user_revenue AS (
  SELECT 
    user_id,
    SUM(CASE WHEN payload->>'revenue_usd' IS NOT NULL 
      THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as total_revenue
  FROM events
  WHERE event_type IN ('ad_revenue', 'purchase_completed')
  GROUP BY user_id
),
user_activity AS (
  SELECT 
    user_id,
    DATE(received_at) as activity_date,
    COUNT(DISTINCT DATE(received_at)) as active_days
  FROM events
  WHERE event_type IN ('app_launched', 'game_started')
  GROUP BY user_id, DATE(received_at)
)
SELECT 
  c.cohort_date,
  c.campaign_id,
  c.platform,
  
  -- Cohort Size
  COUNT(DISTINCT c.user_id) as cohort_size,
  
  -- Retention Metrics
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date THEN c.user_id END) as d0_retained,
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '1 day' THEN c.user_id END) as d1_retained,
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '7 days' THEN c.user_id END) as d7_retained,
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '30 days' THEN c.user_id END) as d30_retained,
  
  -- Retention Rates
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '1 day' THEN c.user_id END) / 
          COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as d1_retention_rate,
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '7 days' THEN c.user_id END) / 
          COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as d7_retention_rate,
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '30 days' THEN c.user_id END) / 
          COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as d30_retention_rate,
  
  -- LTV Metrics
  COALESCE(SUM(ur.total_revenue), 0) as total_revenue,
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(COALESCE(SUM(ur.total_revenue), 0) / COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as ltv,
  
  -- Paying Users
  COUNT(DISTINCT CASE WHEN ur.total_revenue > 0 THEN c.user_id END) as paying_users,
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ur.total_revenue > 0 THEN c.user_id END) / 
          COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as payer_rate
FROM cohorts c
LEFT JOIN user_activity ua ON c.user_id = ua.user_id
LEFT JOIN user_revenue ur ON c.user_id = ur.user_id
WHERE c.cohort_date >= CURRENT_DATE - INTERVAL '90 days' -- Keep 90 days of cohorts
GROUP BY c.cohort_date, c.campaign_id, c.platform
ORDER BY c.cohort_date DESC, c.campaign_id;

-- Create indexes for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_cohort_aggregations_cohort_campaign 
  ON cohort_aggregations(cohort_date, campaign_id, platform);

CREATE INDEX IF NOT EXISTS idx_cohort_aggregations_cohort_date 
  ON cohort_aggregations(cohort_date DESC);

CREATE INDEX IF NOT EXISTS idx_cohort_aggregations_campaign 
  ON cohort_aggregations(campaign_id, cohort_date DESC) 
  WHERE campaign_id IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON MATERIALIZED VIEW cohort_aggregations IS 
  'Pre-aggregated cohort metrics (retention, LTV) by install date and campaign (refreshed daily)';
COMMENT ON COLUMN cohort_aggregations.cohort_date IS 'Install date of the cohort';
COMMENT ON COLUMN cohort_aggregations.d1_retention_rate IS 'Day 1 retention rate (%)';
COMMENT ON COLUMN cohort_aggregations.ltv IS 'Lifetime Value per user in USD';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'cohort_aggregations'
  ) THEN
    RAISE EXCEPTION 'Migration failed: cohort_aggregations materialized view not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 028_create_cohort_aggregations_mv.sql completed successfully';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY cohort_aggregations; to update data';
END $$;

