-- ============================================================================
-- MIGRATION 025 - PART 2: Create partition helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION get_weekly_partition_name(week_start DATE)
RETURNS TEXT AS $$
BEGIN
  RETURN 'events_week_' || TO_CHAR(week_start, 'YYYY_MM_DD');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION create_weekly_partition(week_start DATE)
RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  week_end DATE;
BEGIN
  partition_name := get_weekly_partition_name(week_start);
  week_end := week_start + INTERVAL '7 days';
  
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I PARTITION OF events_partitioned
    FOR VALUES FROM (%L) TO (%L)
  ', partition_name, week_start, week_end);
  
  RAISE NOTICE 'Created partition: %', partition_name;
END;
$$ LANGUAGE plpgsql;

SELECT 'Part 2 completed: Helper functions created' AS status;

