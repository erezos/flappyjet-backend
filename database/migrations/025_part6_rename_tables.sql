-- ============================================================================
-- MIGRATION 025 - PART 6: Rename tables (swap old and new)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    ALTER TABLE events RENAME TO events_backup;
    RAISE NOTICE 'Renamed events to events_backup';
  END IF;
  
  ALTER TABLE events_partitioned RENAME TO events;
  RAISE NOTICE 'Renamed events_partitioned to events';
END $$;

SELECT 'Part 6 completed: Tables renamed' AS status;

