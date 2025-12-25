-- ============================================================================
-- MIGRATION: 040_backfill_missing_user_acquisitions.sql
-- Purpose: Backfill user_acquisitions table with users from user_installed events
-- Date: 2025-12-24
-- 
-- This migration backfills user_acquisitions for users who have user_installed
-- events but are missing from user_acquisitions table.
-- This ensures "New Users Only" filter works correctly.
-- ============================================================================

-- Backfill user_acquisitions from user_installed events
-- Only insert users who don't already exist in user_acquisitions
INSERT INTO user_acquisitions (
  user_id,
  install_date,
  campaign_id,
  source,
  medium,
  campaign,
  platform,
  country
)
SELECT DISTINCT
  e.user_id,
  DATE(e.received_at) as install_date,
  NULL as campaign_id, -- No campaign data from user_installed events
  NULL as source,
  NULL as medium,
  NULL as campaign,
  COALESCE(e.payload->>'platform', 'unknown') as platform,
  COALESCE(e.payload->>'country', NULL) as country
FROM events e
WHERE e.event_type = 'user_installed'
  AND e.user_id NOT IN (SELECT user_id FROM user_acquisitions)
  AND e.received_at >= CURRENT_DATE - INTERVAL '7 days' -- Only backfill last 7 days
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
DECLARE
  backfilled_count INTEGER;
  total_installs INTEGER;
  in_acquisitions INTEGER;
BEGIN
  -- Count how many were backfilled
  SELECT COUNT(*) INTO backfilled_count
  FROM user_acquisitions ua
  WHERE ua.user_id IN (
    SELECT DISTINCT user_id 
    FROM events 
    WHERE event_type = 'user_installed' 
      AND received_at >= CURRENT_DATE - INTERVAL '7 days'
  )
  AND ua.campaign_id IS NULL -- Backfilled users won't have campaign_id
  AND ua.install_date >= CURRENT_DATE - INTERVAL '7 days';
  
  -- Count total installs today
  SELECT COUNT(DISTINCT user_id) INTO total_installs
  FROM events
  WHERE event_type = 'user_installed'
    AND DATE(received_at) = CURRENT_DATE;
  
  -- Count in acquisitions today
  SELECT COUNT(*) INTO in_acquisitions
  FROM user_acquisitions
  WHERE DATE(install_date) = CURRENT_DATE;
  
  RAISE NOTICE '✅ Migration 040_backfill_missing_user_acquisitions.sql completed';
  RAISE NOTICE '📊 Backfilled % users from user_installed events (last 7 days)', backfilled_count;
  RAISE NOTICE '📊 Total installs today: %', total_installs;
  RAISE NOTICE '📊 Users in user_acquisitions today: %', in_acquisitions;
  
  IF total_installs > in_acquisitions THEN
    RAISE WARNING '⚠️ Still missing % users in user_acquisitions. Backend code needs to be deployed.', (total_installs - in_acquisitions);
  END IF;
END $$;

