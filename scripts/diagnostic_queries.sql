-- ============================================================================
-- DIAGNOSTIC QUERIES: Why Charts Are Empty
-- Run these in Railway PostgreSQL Query tab
-- ============================================================================

-- Query 1: Check if skin_purchased events exist
SELECT 
  COUNT(*) as total_skin_purchases,
  COUNT(DISTINCT user_id) as unique_buyers,
  MIN(received_at) as first_purchase,
  MAX(received_at) as last_purchase
FROM events 
WHERE event_type = 'skin_purchased';

-- Query 2: Show recent skin purchases (if any)
SELECT 
  event_id,
  user_id,
  payload->>'jet_id' as jet_id,
  payload->>'jet_name' as jet_name,
  payload->>'rarity' as rarity,
  payload->>'purchase_type' as purchase_type,
  payload->>'cost_coins' as cost_coins,
  payload->>'cost_gems' as cost_gems,
  received_at
FROM events 
WHERE event_type = 'skin_purchased'
ORDER BY received_at DESC
LIMIT 10;

-- Query 3: Check if continue_used events exist
SELECT 
  COUNT(*) as total_continues,
  COUNT(DISTINCT user_id) as users_who_continued,
  MIN(received_at) as first_continue,
  MAX(received_at) as last_continue
FROM events 
WHERE event_type = 'continue_used';

-- Query 4: Show recent continue events (if any)
SELECT 
  event_id,
  user_id,
  payload->>'continue_type' as continue_type,
  payload->>'cost_gems' as cost_gems,
  payload->>'score_at_death' as score,
  received_at
FROM events 
WHERE event_type = 'continue_used'
ORDER BY received_at DESC
LIMIT 10;

-- Query 5: What event types exist in the last 7 days?
SELECT 
  event_type,
  COUNT(*) as count,
  MAX(received_at) as last_occurrence
FROM events
WHERE received_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY event_type
ORDER BY count DESC;

-- Query 6: Check if item_unlocked and item_equipped exist
SELECT 
  event_type,
  COUNT(*) as count
FROM events
WHERE event_type IN ('item_unlocked', 'item_equipped', 'skin_purchased')
GROUP BY event_type;

