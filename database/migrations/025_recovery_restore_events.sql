-- ============================================================================
-- RECOVERY SCRIPT: 025_recovery_restore_events.sql
-- Purpose: Restore events table from backup after failed migration 025
-- Date: 2025-01-20
-- 
-- IMPORTANT: Run this BEFORE retrying migration 025
-- ============================================================================

-- Step 1: Check if events_backup exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events_backup') THEN
    -- Restore events table from backup
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
      RAISE NOTICE 'Events table already exists, dropping it first...';
      DROP TABLE IF EXISTS events CASCADE;
    END IF;
    
    ALTER TABLE events_backup RENAME TO events;
    RAISE NOTICE '✅ Restored events table from events_backup';
  ELSE
    RAISE NOTICE '⚠️ events_backup does not exist - events table may already be restored or never existed';
  END IF;
END $$;

-- Step 2: Clean up any partial migration artifacts
DROP TABLE IF EXISTS events_partitioned CASCADE;
DROP FUNCTION IF EXISTS get_weekly_partition_name(DATE);
DROP FUNCTION IF EXISTS create_weekly_partition(DATE);
DROP FUNCTION IF EXISTS maintain_weekly_partitions();

DO $$
BEGIN
  RAISE NOTICE '✅ Cleanup completed. You can now retry migration 025.';
END $$;

