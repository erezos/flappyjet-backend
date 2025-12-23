-- ============================================================================
-- MIGRATION: 037_enhance_cohort_aggregations.sql
-- Purpose: Enhance cohort_aggregations with D2/D3 retention and separate revenue columns
-- Date: 2025-12-23
-- Author: FlappyJet Analytics Team
-- 
-- Enhancements:
-- - Add D2 and D3 retention metrics
-- - Separate IAP revenue and ad revenue
-- - Add CPI and ROI from campaign_aggregations
-- ============================================================================

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS cohort_aggregations CASCADE;

-- Recreate with enhanced metrics
CREATE MATERIALIZED VIEW cohort_aggregations AS
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
    SUM(CASE WHEN event_type = 'ad_revenue' AND payload->>'revenue_usd' IS NOT NULL 
      THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as ad_revenue,
    SUM(CASE WHEN event_type = 'purchase_completed' AND payload->>'revenue_usd' IS NOT NULL 
      THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as iap_revenue,
    SUM(CASE WHEN payload->>'revenue_usd' IS NOT NULL 
      THEN (payload->>'revenue_usd')::numeric ELSE 0 END) as total_revenue
  FROM events
  WHERE event_type IN ('ad_revenue', 'purchase_completed')
  GROUP BY user_id
),
user_activity AS (
  SELECT 
    user_id,
    DATE(received_at) as activity_date
  FROM events
  WHERE event_type IN ('app_launched', 'game_started')
  GROUP BY user_id, DATE(received_at)
),
campaign_metrics AS (
  -- Get CPI and cost from campaign_aggregations
  SELECT 
    campaign_id,
    date,
    cpi,
    cost_usd,
    roi_percentage
  FROM campaign_aggregations
)
SELECT 
  c.cohort_date,
  c.campaign_id,
  c.platform,
  
  -- Cohort Size
  COUNT(DISTINCT c.user_id) as cohort_size,
  
  -- Retention Metrics ✅ ENHANCED: Added D2 and D3
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date THEN c.user_id END) as d0_retained,
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '1 day' THEN c.user_id END) as d1_retained,
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '2 days' THEN c.user_id END) as d2_retained, -- ✅ NEW
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '3 days' THEN c.user_id END) as d3_retained, -- ✅ NEW
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '7 days' THEN c.user_id END) as d7_retained,
  COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '30 days' THEN c.user_id END) as d30_retained,
  
  -- Retention Rates ✅ ENHANCED: Added D2 and D3
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '1 day' THEN c.user_id END) / 
          COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as d1_retention_rate,
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '2 days' THEN c.user_id END) / 
          COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as d2_retention_rate, -- ✅ NEW
  CASE 
    WHEN COUNT(DISTINCT c.user_id) > 0 
    THEN ROUND(100.0 * COUNT(DISTINCT CASE WHEN ua.activity_date = c.cohort_date + INTERVAL '3 days' THEN c.user_id END) / 
          COUNT(DISTINCT c.user_id), 2)
    ELSE 0
  END as d3_retention_rate, -- ✅ NEW
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
  
  -- Revenue Metrics ✅ ENHANCED: Separate IAP and Ad revenue
  COALESCE(SUM(ur.ad_revenue), 0) as ad_revenue_usd, -- ✅ NEW
  COALESCE(SUM(ur.iap_revenue), 0) as iap_revenue_usd, -- ✅ NEW
  COALESCE(SUM(ur.total_revenue), 0) as total_revenue_usd,
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
  END as payer_rate,
  
  -- Campaign Metrics ✅ NEW: CPI and ROI from campaign_aggregations
  AVG(cm.cpi) as cpi, -- Average CPI for this cohort
  SUM(cm.cost_usd) as cost_usd, -- Total cost for this cohort
  AVG(cm.roi_percentage) as roi_percentage -- Average ROI for this cohort
FROM cohorts c
LEFT JOIN user_activity ua ON c.user_id = ua.user_id
LEFT JOIN user_revenue ur ON c.user_id = ur.user_id
LEFT JOIN campaign_metrics cm ON c.campaign_id = cm.campaign_id 
  AND c.cohort_date = cm.date
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
  'Pre-aggregated cohort metrics (retention D1/D2/D3/D7/D30, LTV, revenue, CPI, ROI) by install date and campaign (refreshed daily)';
COMMENT ON COLUMN cohort_aggregations.d2_retention_rate IS 'Day 2 retention rate (%)';
COMMENT ON COLUMN cohort_aggregations.d3_retention_rate IS 'Day 3 retention rate (%)';
COMMENT ON COLUMN cohort_aggregations.ad_revenue_usd IS 'Total ad revenue from this cohort';
COMMENT ON COLUMN cohort_aggregations.iap_revenue_usd IS 'Total IAP revenue from this cohort';
COMMENT ON COLUMN cohort_aggregations.cpi IS 'Cost Per Install (from campaign_aggregations)';
COMMENT ON COLUMN cohort_aggregations.roi_percentage IS 'Return on Investment percentage (from campaign_aggregations)';

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
  
  RAISE NOTICE '✅ Migration 037_enhance_cohort_aggregations.sql completed successfully';
  RAISE NOTICE '📊 Enhanced cohort_aggregations with: D2/D3 retention, separate IAP/ad revenue, CPI, ROI';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY cohort_aggregations; to update data';
END $$;

