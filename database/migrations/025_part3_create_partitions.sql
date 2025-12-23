-- ============================================================================
-- MIGRATION 025 - PART 3: Create initial partitions
-- ============================================================================

DO $$
DECLARE
  current_week_start DATE;
  week_offset INT;
BEGIN
  current_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
  
  FOR week_offset IN 0..12 LOOP
    PERFORM create_weekly_partition((current_week_start + (week_offset * INTERVAL '7 days'))::DATE);
  END LOOP;
  
  RAISE NOTICE '✅ Created 13 weekly partitions (current week + 12 weeks ahead)';
END $$;

SELECT 'Part 3 completed: Initial partitions created' AS status;

