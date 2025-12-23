-- ============================================================================
-- MIGRATION 025 - PART 5: Migrate existing data
-- ============================================================================

DO $$
DECLARE
  row_count BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    SELECT COUNT(*) INTO row_count FROM events;
    
    IF row_count > 0 THEN
      RAISE NOTICE 'Migrating % rows from events to events_partitioned...', row_count;
      
      INSERT INTO events_partitioned (
        id, event_type, user_id, payload, campaign_id, received_at, 
        processed_at, processing_attempts, processing_error, created_at
      )
      SELECT 
        id, event_type, user_id, payload, 
        COALESCE(campaign_id, payload->>'campaign_id') as campaign_id,
        received_at, processed_at, processing_attempts, processing_error, created_at
      FROM events
      ORDER BY received_at
      ON CONFLICT (id, received_at) DO NOTHING;
      
      RAISE NOTICE '✅ Data migration completed';
    ELSE
      RAISE NOTICE 'Events table exists but is empty, skipping migration';
    END IF;
  ELSE
    RAISE NOTICE 'Events table does not exist, skipping migration';
  END IF;
END $$;

SELECT 'Part 5 completed: Data migrated' AS status;

