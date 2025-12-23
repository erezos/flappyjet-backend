-- ============================================================================
-- RESTORE EVENTS TABLE: Restore from backup after failed migration 025
-- Run this FIRST before retrying migration 025
-- ============================================================================

-- Step 1: Restore events table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events_backup') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
      DROP TABLE events CASCADE;
    END IF;
    ALTER TABLE events_backup RENAME TO events;
    RAISE NOTICE 'Restored events table from events_backup';
  ELSE
    RAISE EXCEPTION 'events_backup does not exist';
  END IF;
END $$;

-- Step 2: Clean up partial migration artifacts
DROP TABLE IF EXISTS events_partitioned CASCADE;
DROP FUNCTION IF EXISTS get_weekly_partition_name(DATE) CASCADE;
DROP FUNCTION IF EXISTS create_weekly_partition(DATE) CASCADE;
DROP FUNCTION IF EXISTS maintain_weekly_partitions() CASCADE;

SELECT 'Restore completed - ready to retry migration 025' AS status;

