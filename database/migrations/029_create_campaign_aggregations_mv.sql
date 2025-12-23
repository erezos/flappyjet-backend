-- ============================================================================
-- MIGRATION: 029_create_campaign_aggregations_mv.sql
-- Purpose: Create campaign aggregations materialized view for ROI analysis
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Campaign Aggregations Materialized View
-- Pre-aggregates ROI metrics by campaign
CREATE MATERIALIZED VIEW IF NOT EXISTS campaign_aggregations AS
WITH campaign_users AS (
  SELECT 
    ua.campaign_id,
    DATE(ua.install_date) as install_date,
    COUNT(DISTINCT ua.user_id) as installs
  FROM user_acquisitions ua
  WHERE ua.campaign_id IS NOT NULL
  GROUP BY ua.campaign_id, DATE(ua.install_date)
),
campaign_revenue AS (
  SELECT 
    e.campaign_id,
    DATE(e.received_at) as date,
    SUM(CASE WHEN e.event_type = 'ad_revenue' AND e.payload->>'revenue_usd' IS NOT NULL 
      THEN (e.payload->>'revenue_usd')::numeric ELSE 0 END) as ad_revenue_usd,
    SUM(CASE WHEN e.event_type = 'purchase_completed' AND e.payload->>'revenue_usd' IS NOT NULL 
      THEN (e.payload->>'revenue_usd')::numeric ELSE 0 END) as iap_revenue_usd
  FROM events e
  WHERE e.campaign_id IS NOT NULL
    AND e.event_type IN ('ad_revenue', 'purchase_completed')
  GROUP BY e.campaign_id, DATE(e.received_at)
),
campaign_costs_data AS (
  SELECT 
    campaign_id,
    date,
    SUM(cost_usd) as cost_usd,
    SUM(installs) as installs_from_ads
  FROM campaign_costs
  GROUP BY campaign_id, date
)
SELECT 
  COALESCE(cu.campaign_id, cr.campaign_id, cc.campaign_id) as campaign_id,
  COALESCE(cu.install_date, cr.date, cc.date) as date,
  
  -- Install Metrics
  COALESCE(cu.installs, 0) as installs,
  COALESCE(cc.installs_from_ads, 0) as installs_from_ads,
  
  -- Cost Metrics
  COALESCE(cc.cost_usd, 0) as cost_usd,
  CASE 
    WHEN COALESCE(cu.installs, 0) > 0 
    THEN ROUND(COALESCE(cc.cost_usd, 0) / cu.installs, 2)
    ELSE NULL
  END as cpi,
  
  -- Revenue Metrics
  COALESCE(cr.ad_revenue_usd, 0) as ad_revenue_usd,
  COALESCE(cr.iap_revenue_usd, 0) as iap_revenue_usd,
  COALESCE(cr.ad_revenue_usd, 0) + COALESCE(cr.iap_revenue_usd, 0) as total_revenue_usd,
  
  -- ROI Metrics
  CASE 
    WHEN COALESCE(cc.cost_usd, 0) > 0 
    THEN ROUND(((COALESCE(cr.ad_revenue_usd, 0) + COALESCE(cr.iap_revenue_usd, 0) - cc.cost_usd) / cc.cost_usd) * 100, 2)
    ELSE NULL
  END as roi_percentage,
  COALESCE(cr.ad_revenue_usd, 0) + COALESCE(cr.iap_revenue_usd, 0) - COALESCE(cc.cost_usd, 0) as net_profit_usd
FROM campaign_users cu
FULL OUTER JOIN campaign_revenue cr ON cu.campaign_id = cr.campaign_id AND cu.install_date = cr.date
FULL OUTER JOIN campaign_costs_data cc ON COALESCE(cu.campaign_id, cr.campaign_id) = cc.campaign_id 
  AND COALESCE(cu.install_date, cr.date) = cc.date
WHERE COALESCE(cu.install_date, cr.date, cc.date) >= CURRENT_DATE - INTERVAL '90 days' -- Keep 90 days
ORDER BY COALESCE(cu.install_date, cr.date, cc.date) DESC, COALESCE(cu.campaign_id, cr.campaign_id, cc.campaign_id);

-- Create indexes for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_aggregations_campaign_date 
  ON campaign_aggregations(campaign_id, date);

CREATE INDEX IF NOT EXISTS idx_campaign_aggregations_date 
  ON campaign_aggregations(date DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_aggregations_campaign 
  ON campaign_aggregations(campaign_id, date DESC);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON MATERIALIZED VIEW campaign_aggregations IS 
  'Pre-aggregated campaign ROI metrics (cost, revenue, CPI, ROI) by campaign and date (refreshed daily)';
COMMENT ON COLUMN campaign_aggregations.cpi IS 'Cost Per Install (cost_usd / installs)';
COMMENT ON COLUMN campaign_aggregations.roi_percentage IS 'Return on Investment percentage ((revenue - cost) / cost * 100)';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'campaign_aggregations'
  ) THEN
    RAISE EXCEPTION 'Migration failed: campaign_aggregations materialized view not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 029_create_campaign_aggregations_mv.sql completed successfully';
  RAISE NOTICE '📊 Run REFRESH MATERIALIZED VIEW CONCURRENTLY campaign_aggregations; to update data';
END $$;

