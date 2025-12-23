-- ============================================================================
-- MIGRATION 025 - PART 7: Create partition maintenance function
-- ============================================================================

CREATE OR REPLACE FUNCTION maintain_weekly_partitions()
RETURNS VOID AS $$
DECLARE
  current_week_start DATE;
  oldest_week_start DATE;
  week_offset INT;
  partition_name TEXT;
BEGIN
  current_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
  
  FOR week_offset IN 0..12 LOOP
    PERFORM create_weekly_partition((current_week_start + (week_offset * INTERVAL '7 days'))::DATE);
  END LOOP;
  
  oldest_week_start := (current_week_start - INTERVAL '52 weeks')::DATE;
  
  FOR partition_name IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename LIKE 'events_week_%'
      AND tablename < get_weekly_partition_name(oldest_week_start)
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', partition_name);
    RAISE NOTICE 'Dropped old partition: %', partition_name;
  END LOOP;
  
  RAISE NOTICE '✅ Partition maintenance completed';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION maintain_weekly_partitions() IS 
  'Maintains weekly partitions: creates future partitions and drops old ones (>12 months)';

SELECT 'Part 7 completed: Maintenance function created' AS status;

