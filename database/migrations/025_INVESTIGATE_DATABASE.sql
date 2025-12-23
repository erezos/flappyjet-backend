-- ============================================================================
-- INVESTIGATE DATABASE: Check what tables exist and their state
-- ============================================================================

-- List all tables in the database
SELECT 
  table_name,
  table_type
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- Check if there are any event-related tables
SELECT 
  table_name
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND (table_name LIKE '%event%' OR table_name LIKE '%backup%')
ORDER BY table_name;

-- Check for partitioned tables
SELECT 
  c.relname as table_name,
  c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relkind IN ('r', 'p') -- 'r' = regular table, 'p' = partitioned table
ORDER BY c.relname;

