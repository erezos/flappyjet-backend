-- ============================================================================
-- RECOVERY SCRIPT: Restore events table from backup after failed migration 025
-- IMPORTANT: Copy and paste this ENTIRE script into Railway PostgreSQL CLI
-- ============================================================================

-- Step 1: Restore events table from backup
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events_backup') THEN
    -- Drop events if it exists (might be partial)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
      RAISE NOTICE 'Dropping existing events table...';
      DROP TABLE IF EXISTS events CASCADE;
    END IF;
    
    -- Restore from backup
    ALTER TABLE events_backup RENAME TO events;
    RAISE NOTICE '✅ Restored events table from events_backup';
  ELSE
    RAISE NOTICE '⚠️ events_backup does not exist';
  END IF;
END $$;

-- Step 2: Clean up partial migration artifacts
DROP TABLE IF EXISTS events_partitioned CASCADE;
DROP FUNCTION IF EXISTS get_weekly_partition_name(DATE) CASCADE;
DROP FUNCTION IF EXISTS create_weekly_partition(DATE) CASCADE;
DROP FUNCTION IF EXISTS maintain_weekly_partitions() CASCADE;

DO $$
BEGIN
  RAISE NOTICE '✅ Cleanup completed. You can now retry migration 025.';
END $$;

