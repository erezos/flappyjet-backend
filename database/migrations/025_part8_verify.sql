-- ============================================================================
-- MIGRATION 025 - PART 8: Verify migration
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' 
      AND c.relname = 'events'
      AND c.relkind = 'p'
  ) THEN
    RAISE EXCEPTION 'Migration failed: events table is not partitioned';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_inherits
    WHERE inhparent = 'events'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration failed: No partitions found for events table';
  END IF;
  
  RAISE NOTICE '✅ Migration 025 completed successfully';
  RAISE NOTICE '📊 Events table is now partitioned by week';
  RAISE NOTICE '📊 Run maintain_weekly_partitions() weekly (via cron) to create future partitions';
END $$;

