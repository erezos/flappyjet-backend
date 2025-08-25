-- 🚀 Performance Optimization Indexes for FlappyJet Pro
-- Optimized database indexes for enhanced leaderboard performance

-- ============================================================================
-- LEADERBOARD PERFORMANCE INDEXES
-- ============================================================================

-- 1. Primary leaderboard query optimization (score DESC, achieved_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_leaderboard_primary 
ON scores (score DESC, achieved_at DESC) 
WHERE score > 0;

-- 2. Player-specific score queries (player_id, achieved_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_player_history 
ON scores (player_id, achieved_at DESC) 
WHERE score > 0;

-- 3. Time-based leaderboard queries (daily, weekly, monthly)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_time_periods 
ON scores (achieved_at DESC, score DESC) 
WHERE score > 0;

-- 4. Player best score lookup (player_id, score DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_player_best 
ON scores (player_id, score DESC) 
WHERE score > 0;

-- 5. Rank calculation optimization (score range queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_rank_calculation 
ON scores (score) 
WHERE score > 0;

-- 6. Composite index for leaderboard with player context
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_leaderboard_context 
ON scores (score DESC, player_id, achieved_at DESC) 
WHERE score > 0;

-- ============================================================================
-- ANALYTICS PERFORMANCE INDEXES
-- ============================================================================

-- 7. Analytics events by player and time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_player_time 
ON analytics_events (player_id, created_at DESC);

-- 8. Analytics events by event type and time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_event_type_time 
ON analytics_events (event_type, created_at DESC);

-- 9. Analytics events cleanup index (created_at only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_cleanup 
ON analytics_events (created_at) 
WHERE created_at < NOW() - INTERVAL '90 days';

-- ============================================================================
-- PLAYER DATA INDEXES
-- ============================================================================

-- 10. Player profile lookup optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_profile_lookup 
ON players (id, nickname, created_at);

-- 11. Player authentication lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_auth_lookup 
ON players (email) 
WHERE email IS NOT NULL;

-- ============================================================================
-- MISSIONS AND ACHIEVEMENTS INDEXES
-- ============================================================================

-- 12. Player missions lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_missions_lookup 
ON player_missions (player_id, mission_id, completed_at);

-- 13. Player achievements lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_achievements_lookup 
ON player_achievements (player_id, achievement_id, unlocked_at);

-- 14. Active missions query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_missions_active 
ON missions (is_active, start_date, end_date) 
WHERE is_active = true;

-- ============================================================================
-- PURCHASE AND ECONOMY INDEXES
-- ============================================================================

-- 15. Player purchases history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchases_player_history 
ON purchases (player_id, created_at DESC);

-- 16. Purchase validation lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchases_validation 
ON purchases (transaction_id, status) 
WHERE status IN ('pending', 'completed');

-- ============================================================================
-- ANTI-CHEAT INDEXES
-- ============================================================================

-- 17. Anti-cheat score analysis (recent scores by player)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_anticheat_analysis 
ON scores (player_id, achieved_at DESC, score, survival_time) 
WHERE achieved_at > NOW() - INTERVAL '24 hours';

-- 18. Suspicious score patterns detection
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_suspicious_patterns 
ON scores (score, survival_time, achieved_at) 
WHERE score > 1000 OR survival_time > 300000;

-- ============================================================================
-- PARTIAL INDEXES FOR PERFORMANCE
-- ============================================================================

-- 19. Recent high scores only (last 30 days, score > 100)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_recent_high 
ON scores (score DESC, achieved_at DESC) 
WHERE achieved_at > NOW() - INTERVAL '30 days' AND score > 100;

-- 20. Top players index (top 1000 scores only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_top_players 
ON scores (score DESC, player_id, achieved_at DESC) 
WHERE score >= (
  SELECT score FROM scores 
  ORDER BY score DESC 
  LIMIT 1 OFFSET 999
);

-- ============================================================================
-- STATISTICS AND MONITORING INDEXES
-- ============================================================================

-- 21. Daily statistics calculation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_daily_stats 
ON scores (DATE(achieved_at), score) 
WHERE achieved_at > NOW() - INTERVAL '7 days';

-- 22. Player activity monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_activity_monitoring 
ON players (last_login_at DESC, created_at DESC) 
WHERE last_login_at IS NOT NULL;

-- ============================================================================
-- MAINTENANCE INDEXES
-- ============================================================================

-- 23. Old data cleanup index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_cleanup 
ON scores (achieved_at) 
WHERE achieved_at < NOW() - INTERVAL '1 year';

-- 24. Duplicate detection index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_duplicate_detection 
ON scores (player_id, score, survival_time, achieved_at);

-- ============================================================================
-- PERFORMANCE MONITORING QUERIES
-- ============================================================================

-- View to monitor index usage
CREATE OR REPLACE VIEW v_index_usage_stats AS
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_tup_read,
  idx_tup_fetch,
  idx_scan,
  CASE 
    WHEN idx_scan = 0 THEN 'UNUSED'
    WHEN idx_scan < 100 THEN 'LOW_USAGE'
    WHEN idx_scan < 1000 THEN 'MODERATE_USAGE'
    ELSE 'HIGH_USAGE'
  END as usage_category
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- View to monitor table sizes and performance
CREATE OR REPLACE VIEW v_table_performance_stats AS
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes,
  n_live_tup as live_tuples,
  n_dead_tup as dead_tuples,
  CASE 
    WHEN n_live_tup > 0 THEN ROUND((n_dead_tup::float / n_live_tup::float) * 100, 2)
    ELSE 0 
  END as dead_tuple_percentage
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================================================
-- PERFORMANCE OPTIMIZATION NOTES
-- ============================================================================

/*
PERFORMANCE OPTIMIZATION STRATEGY:

1. LEADERBOARD QUERIES:
   - Primary index on (score DESC, achieved_at DESC) for main leaderboard
   - Player-specific indexes for personal history and best scores
   - Time-based indexes for period filtering (daily, weekly, monthly)

2. ANTI-CHEAT OPTIMIZATION:
   - Specialized indexes for recent score analysis
   - Pattern detection indexes for suspicious behavior
   - Efficient lookups for validation queries

3. ANALYTICS PERFORMANCE:
   - Time-based partitioning consideration for large datasets
   - Efficient cleanup indexes for old data removal
   - Player and event type specific indexes

4. MAINTENANCE:
   - Regular VACUUM and ANALYZE operations
   - Monitor index usage with v_index_usage_stats
   - Track table performance with v_table_performance_stats

5. CACHING STRATEGY:
   - Redis caching for frequently accessed leaderboards
   - Application-level caching for static data
   - WebSocket real-time updates to reduce database load

MONITORING COMMANDS:
- SELECT * FROM v_index_usage_stats;
- SELECT * FROM v_table_performance_stats;
- EXPLAIN (ANALYZE, BUFFERS) SELECT ... -- for query analysis
*/
