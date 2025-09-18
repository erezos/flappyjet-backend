-- 🏆 Tournament Analytics Views for Dashboard Integration
-- Extends the existing analytics dashboard with tournament-specific metrics

-- ============================================================================
-- 1. DAILY TOURNAMENT METRICS
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_tournament_metrics AS
SELECT 
    DATE(tp.registered_at) as date,
    
    -- Tournament Participation
    COUNT(DISTINCT tp.player_id) as tournament_participants,
    COUNT(DISTINCT tp.tournament_id) as active_tournaments,
    COUNT(DISTINCT CASE WHEN tp.total_games > 0 THEN tp.player_id END) as active_tournament_players,
    
    -- Tournament Performance
    AVG(tp.best_score) as avg_tournament_score,
    MAX(tp.best_score) as max_tournament_score,
    SUM(tp.total_games) as total_tournament_games,
    AVG(tp.total_games) as avg_games_per_participant,
    
    -- Tournament Completion
    COUNT(CASE WHEN tp.total_games > 0 THEN 1 END) as completed_participants,
    ROUND(
        COUNT(CASE WHEN tp.total_games > 0 THEN 1 END)::numeric / 
        NULLIF(COUNT(tp.player_id), 0) * 100, 2
    ) as completion_rate_percent,
    
    -- Prize Distribution
    SUM(tp.prize_won) as total_prizes_distributed,
    COUNT(CASE WHEN tp.prize_won > 0 THEN 1 END) as prize_winners,
    
    -- Tournament vs Regular Play Comparison
    (
        SELECT AVG(best_score) 
        FROM players 
        WHERE updated_at::date = DATE(tp.registered_at)
    ) as avg_regular_score_same_day

FROM tournament_participants tp
JOIN tournaments t ON tp.tournament_id = t.id
WHERE tp.registered_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(tp.registered_at)
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_tournament_metrics_date 
ON daily_tournament_metrics (date);

-- ============================================================================
-- 2. TOURNAMENT REVENUE IMPACT
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS tournament_revenue_impact AS
SELECT 
    DATE(ae.created_at) as date,
    
    -- Tournament-Related Revenue
    SUM(CASE 
        WHEN ae.event_name = 'iap_purchase' 
        AND ae.event_data->>'context' = 'tournament'
        THEN (ae.event_data->>'price_usd')::decimal 
        ELSE 0 
    END) as tournament_driven_revenue,
    
    -- Tournament-Related Purchases
    COUNT(CASE 
        WHEN ae.event_name = 'iap_purchase' 
        AND ae.event_data->>'context' = 'tournament'
        THEN 1 
    END) as tournament_driven_purchases,
    
    -- Tournament Prize Costs
    (
        SELECT COALESCE(SUM(tp.prize_won), 0)
        FROM tournament_participants tp
        WHERE DATE(tp.prize_claimed_at) = DATE(ae.created_at)
    ) as daily_prize_costs,
    
    -- Tournament ROI Calculation
    CASE 
        WHEN (
            SELECT COALESCE(SUM(tp.prize_won), 0)
            FROM tournament_participants tp
            WHERE DATE(tp.prize_claimed_at) = DATE(ae.created_at)
        ) > 0 
        THEN ROUND(
            SUM(CASE 
                WHEN ae.event_name = 'iap_purchase' 
                AND ae.event_data->>'context' = 'tournament'
                THEN (ae.event_data->>'price_usd')::decimal 
                ELSE 0 
            END) / NULLIF((
                SELECT COALESCE(SUM(tp.prize_won), 0)
                FROM tournament_participants tp
                WHERE DATE(tp.prize_claimed_at) = DATE(ae.created_at)
            ), 0) * 100, 2
        )
        ELSE 0
    END as tournament_roi_percent

FROM analytics_events ae
WHERE ae.created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(ae.created_at)
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_revenue_impact_date 
ON tournament_revenue_impact (date);

-- ============================================================================
-- 3. TOURNAMENT USER RETENTION
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS tournament_user_retention AS
WITH tournament_users AS (
    SELECT DISTINCT 
        tp.player_id,
        DATE(tp.registered_at) as first_tournament_date,
        COUNT(DISTINCT tp.tournament_id) as tournaments_joined
    FROM tournament_participants tp
    GROUP BY tp.player_id, DATE(tp.registered_at)
),
retention_analysis AS (
    SELECT 
        tu.first_tournament_date as date,
        COUNT(tu.player_id) as new_tournament_users,
        
        -- Day 1 Tournament Retention
        COUNT(CASE 
            WHEN EXISTS (
                SELECT 1 FROM tournament_participants tp2 
                WHERE tp2.player_id = tu.player_id 
                AND DATE(tp2.registered_at) = tu.first_tournament_date + INTERVAL '1 day'
            ) THEN 1 
        END) as day1_tournament_retained,
        
        -- Day 7 Tournament Retention  
        COUNT(CASE 
            WHEN EXISTS (
                SELECT 1 FROM tournament_participants tp2 
                WHERE tp2.player_id = tu.player_id 
                AND DATE(tp2.registered_at) BETWEEN 
                    tu.first_tournament_date + INTERVAL '1 day' AND 
                    tu.first_tournament_date + INTERVAL '7 days'
            ) THEN 1 
        END) as day7_tournament_retained,
        
        -- Overall Game Retention (not just tournaments)
        COUNT(CASE 
            WHEN EXISTS (
                SELECT 1 FROM analytics_events ae 
                WHERE ae.player_id = tu.player_id 
                AND ae.event_name = 'game_start'
                AND DATE(ae.created_at) = tu.first_tournament_date + INTERVAL '1 day'
            ) THEN 1 
        END) as day1_game_retained
        
    FROM tournament_users tu
    WHERE tu.first_tournament_date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY tu.first_tournament_date
)
SELECT 
    date,
    new_tournament_users,
    day1_tournament_retained,
    day7_tournament_retained,
    day1_game_retained,
    
    -- Calculate retention percentages
    ROUND(
        day1_tournament_retained::numeric / NULLIF(new_tournament_users, 0) * 100, 2
    ) as day1_tournament_retention_percent,
    
    ROUND(
        day7_tournament_retained::numeric / NULLIF(new_tournament_users, 0) * 100, 2
    ) as day7_tournament_retention_percent,
    
    ROUND(
        day1_game_retained::numeric / NULLIF(new_tournament_users, 0) * 100, 2
    ) as day1_game_retention_percent

FROM retention_analysis
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_user_retention_date 
ON tournament_user_retention (date);

-- ============================================================================
-- 4. ENHANCED DAILY KPI SUMMARY (with Tournament Metrics)
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_kpi_summary_enhanced AS
SELECT 
    dks.*,
    
    -- Tournament Metrics
    COALESCE(dtm.tournament_participants, 0) as tournament_participants,
    COALESCE(dtm.active_tournaments, 0) as active_tournaments,
    COALESCE(dtm.completion_rate_percent, 0) as tournament_completion_rate,
    COALESCE(dtm.avg_tournament_score, 0) as avg_tournament_score,
    COALESCE(dtm.total_prizes_distributed, 0) as total_prizes_distributed,
    
    -- Tournament Revenue Impact
    COALESCE(tri.tournament_driven_revenue, 0) as tournament_revenue,
    COALESCE(tri.tournament_driven_purchases, 0) as tournament_purchases,
    COALESCE(tri.daily_prize_costs, 0) as tournament_prize_costs,
    COALESCE(tri.tournament_roi_percent, 0) as tournament_roi,
    
    -- Tournament Retention
    COALESCE(tur.day1_tournament_retention_percent, 0) as tournament_day1_retention,
    COALESCE(tur.day7_tournament_retention_percent, 0) as tournament_day7_retention,
    
    -- Tournament Engagement Metrics
    CASE 
        WHEN dks.daily_active_users > 0 
        THEN ROUND(COALESCE(dtm.tournament_participants, 0)::numeric / dks.daily_active_users * 100, 2)
        ELSE 0 
    END as tournament_participation_rate,
    
    CASE 
        WHEN COALESCE(dtm.tournament_participants, 0) > 0 
        THEN ROUND(COALESCE(dtm.avg_tournament_score, 0) / NULLIF(COALESCE(dtm.avg_regular_score_same_day, 1), 0), 2)
        ELSE 0 
    END as tournament_score_multiplier

FROM daily_kpi_summary dks
LEFT JOIN daily_tournament_metrics dtm ON dks.date = dtm.date
LEFT JOIN tournament_revenue_impact tri ON dks.date = tri.date  
LEFT JOIN tournament_user_retention tur ON dks.date = tur.date
WHERE dks.date >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY dks.date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_kpi_summary_enhanced_date 
ON daily_kpi_summary_enhanced (date);

-- ============================================================================
-- 5. TOURNAMENT PERFORMANCE SUMMARY
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS tournament_performance_summary AS
SELECT 
    t.id as tournament_id,
    t.name as tournament_name,
    t.tournament_type,
    t.start_date,
    t.end_date,
    t.status,
    t.prize_pool,
    
    -- Participation Metrics
    COUNT(tp.player_id) as total_participants,
    COUNT(CASE WHEN tp.total_games > 0 THEN 1 END) as active_participants,
    ROUND(
        COUNT(CASE WHEN tp.total_games > 0 THEN 1 END)::numeric / 
        NULLIF(COUNT(tp.player_id), 0) * 100, 2
    ) as participation_rate,
    
    -- Performance Metrics
    AVG(tp.best_score) as avg_score,
    MAX(tp.best_score) as winning_score,
    SUM(tp.total_games) as total_games_played,
    AVG(tp.total_games) as avg_games_per_player,
    
    -- Prize Distribution
    SUM(tp.prize_won) as total_prizes_awarded,
    COUNT(CASE WHEN tp.prize_won > 0 THEN 1 END) as prize_winners,
    
    -- Revenue Impact (estimated)
    (
        SELECT COALESCE(SUM((ae.event_data->>'price_usd')::decimal), 0)
        FROM analytics_events ae
        WHERE ae.event_name = 'iap_purchase'
        AND ae.event_data->>'context' = 'tournament'
        AND ae.created_at BETWEEN t.start_date AND t.end_date
    ) as estimated_revenue_impact

FROM tournaments t
LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
WHERE t.created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY t.id, t.name, t.tournament_type, t.start_date, t.end_date, t.status, t.prize_pool
ORDER BY t.start_date DESC;

-- ============================================================================
-- 6. REFRESH FUNCTION FOR TOURNAMENT VIEWS
-- ============================================================================
CREATE OR REPLACE FUNCTION refresh_tournament_analytics_views()
RETURNS void AS $$
BEGIN
    -- Refresh tournament-specific views
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_tournament_metrics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY tournament_revenue_impact;
    REFRESH MATERIALIZED VIEW CONCURRENTLY tournament_user_retention;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_kpi_summary_enhanced;
    REFRESH MATERIALIZED VIEW CONCURRENTLY tournament_performance_summary;
    
    -- Log the refresh
    INSERT INTO system_logs (level, message, created_at) 
    VALUES ('INFO', 'Tournament analytics views refreshed', NOW());
    
    RAISE NOTICE 'Tournament analytics views refreshed successfully';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. TOURNAMENT ANALYTICS API ENDPOINTS DATA
-- ============================================================================

-- View for tournament KPI cards
CREATE VIEW tournament_kpi_cards AS
SELECT 
    date,
    tournament_participants,
    tournament_completion_rate,
    tournament_revenue,
    tournament_roi,
    tournament_participation_rate,
    tournament_day1_retention
FROM daily_kpi_summary_enhanced
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;

-- View for tournament trends chart
CREATE VIEW tournament_trends AS
SELECT 
    date,
    tournament_participants,
    tournament_revenue,
    tournament_completion_rate,
    tournament_participation_rate
FROM daily_kpi_summary_enhanced
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
AND tournament_participants > 0
ORDER BY date ASC;
