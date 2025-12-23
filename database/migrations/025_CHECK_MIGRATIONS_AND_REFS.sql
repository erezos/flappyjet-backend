-- ============================================================================
-- CHECK MIGRATIONS AND REFERENCES: Understand database state
-- ============================================================================

-- Check what migrations have been run
SELECT 
  id,
  name,
  executed_at
FROM migrations
ORDER BY executed_at DESC
LIMIT 20;

-- Check if tournament_events has a foreign key to events table
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'tournament_events';

-- Check the structure of analytics_events to see if it's similar to events
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'analytics_events'
ORDER BY ordinal_position
LIMIT 10;

-- Check if there are any references to 'events' table in the database
SELECT 
  table_name,
  column_name
FROM information_schema.columns
WHERE column_name LIKE '%event%'
ORDER BY table_name, column_name;

