-- ============================================================================
-- CLEAN RESTART: Migration 025
-- Complete cleanup script - run this before retrying migration 025
-- ============================================================================

-- Step 1: Complete cleanup of partial migration artifacts
DO $$
BEGIN
  -- Drop any partial migration artifacts
  DROP TABLE IF EXISTS events_partitioned CASCADE;
  DROP FUNCTION IF EXISTS get_weekly_partition_name(DATE) CASCADE;
  DROP FUNCTION IF EXISTS create_weekly_partition(DATE) CASCADE;
  DROP FUNCTION IF EXISTS maintain_weekly_partitions() CASCADE;
  
  -- Check if events table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    RAISE NOTICE '✅ Events table exists - ready for migration';
  ELSE
    RAISE NOTICE '⚠️ Events table does not exist - cannot proceed';
  END IF;
  
  RAISE NOTICE '✅ Cleanup completed. You can now run migration 025.';
END $$;

