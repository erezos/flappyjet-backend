-- ============================================================================
-- FIND ALL EVENT TYPES: Query actual event types in the database
-- Run this to see what event types need to be added to the constraint
-- ============================================================================

SELECT DISTINCT event_type 
FROM events 
ORDER BY event_type;

