-- Quick verification query to check if constraint exists
SELECT 
  conname as constraint_name,
  contype as constraint_type,
  CASE 
    WHEN contype = 'c' THEN 'CHECK constraint'
    ELSE contype::text
  END as constraint_type_name
FROM pg_constraint 
WHERE conname = 'valid_event_type' 
  AND conrelid = 'events'::regclass;

-- If no rows returned, constraint doesn't exist
-- If 1 row returned, constraint exists ✅

