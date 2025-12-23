-- ============================================================================
-- CHECK AND RESTORE: Check database state and restore events table if needed
-- ============================================================================

-- Check current state
DO $$
BEGIN
  -- Check if events table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    RAISE NOTICE '✅ Events table exists';
  ELSE
    RAISE NOTICE '⚠️ Events table does NOT exist';
    
    -- Check if events_backup exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events_backup') THEN
      RAISE NOTICE '✅ events_backup exists - will restore it';
    ELSE
      RAISE NOTICE '❌ events_backup does NOT exist - events table is missing!';
      RAISE NOTICE '⚠️ WARNING: You may need to restore from a database backup';
    END IF;
  END IF;
END $$;

-- Restore events from backup if needed
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events_backup') THEN
      ALTER TABLE events_backup RENAME TO events;
      RAISE NOTICE '✅ Restored events table from events_backup';
    ELSE
      RAISE EXCEPTION 'Cannot proceed: events table does not exist and events_backup does not exist. Restore from database backup first.';
    END IF;
  ELSE
    RAISE NOTICE '✅ Events table already exists - no restore needed';
  END IF;
END $$;

