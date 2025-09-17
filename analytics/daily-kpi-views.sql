-- 📊 Daily KPI Dashboard - Materialized Views
-- FlappyJet Pro Analytics System
-- Refreshes twice daily for optimal performance

-- ============================================================================
-- 1. DAILY ACTIVE USERS (DAU)
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_active_users AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT player_id) as dau,
    COUNT(DISTINCT CASE WHEN event_name = 'game_start' THEN player_id END) as gaming_users,
    COUNT(DISTINCT CASE WHEN event_category = 'monetization' THEN player_id END) as monetizing_users,
    -- Platform breakdown
    COUNT(DISTINCT CASE WHEN parameters->>'platform' = 'android' THEN player_id END) as android_users,
    COUNT(DISTINCT CASE WHEN parameters->>'platform' = 'ios' THEN player_id END) as ios_users
FROM analytics_events 
WHERE created_at >= CURRENT_DATE - INTERVAL '60 days'
    AND player_id IS NOT NULL
GROUP BY DATE(created_at)
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_active_users_date ON daily_active_users (date);

-- ============================================================================
-- 2. DAILY REVENUE
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_revenue AS
SELECT 
    DATE(created_at) as date,
    -- Revenue metrics
    COUNT(*) as total_purchases,
    COUNT(DISTINCT player_id) as paying_users,
    SUM(amount_usd) as total_revenue_usd,
    AVG(amount_usd) as avg_purchase_value,
    -- Product breakdown
    COUNT(CASE WHEN product_id LIKE '%gem%' THEN 1 END) as gem_purchases,
    COUNT(CASE WHEN product_id LIKE '%heart%' THEN 1 END) as heart_purchases,
    COUNT(CASE WHEN product_id LIKE '%jet%' THEN 1 END) as jet_purchases,
    -- Platform breakdown
    SUM(CASE WHEN platform = 'android' THEN amount_usd ELSE 0 END) as android_revenue,
    SUM(CASE WHEN platform = 'ios' THEN amount_usd ELSE 0 END) as ios_revenue
FROM purchases 
WHERE status = 'completed'
    AND created_at >= CURRENT_DATE - INTERVAL '60 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_revenue_date ON daily_revenue (date);

-- ============================================================================
-- 3. RETENTION COHORTS
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS retention_cohorts AS
WITH player_first_seen AS (
    SELECT 
        player_id,
        DATE(MIN(created_at)) as install_date
    FROM analytics_events 
    WHERE created_at >= CURRENT_DATE - INTERVAL '60 days'
    GROUP BY player_id
),
player_activity AS (
    SELECT 
        pfs.player_id,
        pfs.install_date,
        DATE(ae.created_at) as activity_date,
        DATE(ae.created_at) - pfs.install_date as days_since_install
    FROM player_first_seen pfs
    JOIN analytics_events ae ON pfs.player_id = ae.player_id
    WHERE ae.created_at >= CURRENT_DATE - INTERVAL '60 days'
)
SELECT 
    install_date,
    COUNT(DISTINCT player_id) as cohort_size,
    -- Day 1 retention
    COUNT(DISTINCT CASE WHEN days_since_install = 1 THEN player_id END) as day1_retained,
    ROUND(
        COUNT(DISTINCT CASE WHEN days_since_install = 1 THEN player_id END)::numeric / 
        COUNT(DISTINCT player_id) * 100, 2
    ) as day1_retention_rate,
    -- Day 7 retention
    COUNT(DISTINCT CASE WHEN days_since_install = 7 THEN player_id END) as day7_retained,
    ROUND(
        COUNT(DISTINCT CASE WHEN days_since_install = 7 THEN player_id END)::numeric / 
        COUNT(DISTINCT player_id) * 100, 2
    ) as day7_retention_rate,
    -- Day 30 retention
    COUNT(DISTINCT CASE WHEN days_since_install = 30 THEN player_id END) as day30_retained,
    ROUND(
        COUNT(DISTINCT CASE WHEN days_since_install = 30 THEN player_id END)::numeric / 
        COUNT(DISTINCT player_id) * 100, 2
    ) as day30_retention_rate
FROM player_activity
GROUP BY install_date
HAVING COUNT(DISTINCT player_id) >= 5  -- Only show cohorts with at least 5 users
ORDER BY install_date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_retention_cohorts_date ON retention_cohorts (install_date);

-- ============================================================================
-- 4. DAILY CRASHES & ERRORS
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_crashes AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_errors,
    COUNT(DISTINCT player_id) as affected_users,
    -- Error breakdown
    COUNT(CASE WHEN parameters->>'fatal' = 'true' THEN 1 END) as fatal_crashes,
    COUNT(CASE WHEN parameters->>'fatal' = 'false' THEN 1 END) as non_fatal_errors,
    -- Platform breakdown
    COUNT(CASE WHEN parameters->>'platform' = 'android' THEN 1 END) as android_errors,
    COUNT(CASE WHEN parameters->>'platform' = 'ios' THEN 1 END) as ios_errors,
    -- Most common error types
    MODE() WITHIN GROUP (ORDER BY parameters->>'error_type') as most_common_error
FROM analytics_events 
WHERE event_name = 'error_occurred'
    AND created_at >= CURRENT_DATE - INTERVAL '60 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_crashes_date ON daily_crashes (date);

-- ============================================================================
-- 5. DAILY ENGAGEMENT METRICS
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_engagement AS
WITH daily_sessions AS (
    SELECT 
        DATE(created_at) as date,
        player_id,
        session_id,
        COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) as games_in_session,
        EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 60 as session_duration_minutes,
        AVG(CASE WHEN event_name = 'game_end' THEN (parameters->>'final_score')::int END) as avg_session_score
    FROM analytics_events 
    WHERE created_at >= CURRENT_DATE - INTERVAL '60 days'
        AND session_id IS NOT NULL
    GROUP BY DATE(created_at), player_id, session_id
)
SELECT 
    date,
    COUNT(DISTINCT player_id) as active_players,
    COUNT(*) as total_sessions,
    ROUND(AVG(games_in_session), 2) as avg_games_per_session,
    ROUND(AVG(session_duration_minutes), 2) as avg_session_duration_minutes,
    ROUND(AVG(avg_session_score), 2) as avg_score_per_session,
    -- Engagement quality metrics
    COUNT(CASE WHEN games_in_session >= 3 THEN 1 END) as high_engagement_sessions,
    COUNT(CASE WHEN session_duration_minutes >= 5 THEN 1 END) as long_sessions,
    ROUND(
        COUNT(CASE WHEN games_in_session >= 3 THEN 1 END)::numeric / 
        COUNT(*) * 100, 2
    ) as high_engagement_rate
FROM daily_sessions
GROUP BY date
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_engagement_date ON daily_engagement (date);

-- ============================================================================
-- 6. MONETIZATION FUNNEL METRICS
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_monetization_funnel AS
SELECT 
    DATE(created_at) as date,
    -- Ad metrics
    COUNT(CASE WHEN event_name = 'ad_event' AND parameters->>'action' = 'shown' THEN 1 END) as ads_shown,
    COUNT(CASE WHEN event_name = 'ad_event' AND parameters->>'action' = 'completed' THEN 1 END) as ads_completed,
    COUNT(CASE WHEN event_name = 'rewarded_ad_reward_granted' THEN 1 END) as ad_rewards_granted,
    -- IAP funnel
    COUNT(DISTINCT CASE WHEN event_name = 'store_opened' THEN player_id END) as store_visitors,
    COUNT(DISTINCT CASE WHEN event_name = 'purchase' THEN player_id END) as purchase_attempts,
    -- Conversion rates
    ROUND(
        COUNT(CASE WHEN event_name = 'ad_event' AND parameters->>'action' = 'completed' THEN 1 END)::numeric /
        NULLIF(COUNT(CASE WHEN event_name = 'ad_event' AND parameters->>'action' = 'shown' THEN 1 END), 0) * 100, 2
    ) as ad_completion_rate
FROM analytics_events 
WHERE created_at >= CURRENT_DATE - INTERVAL '60 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_monetization_date ON daily_monetization_funnel (date);

-- ============================================================================
-- 7. SUMMARY KPI VIEW (Main Dashboard Data)
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_kpi_summary AS
SELECT 
    d.date,
    -- User metrics
    COALESCE(dau.dau, 0) as daily_active_users,
    COALESCE(dau.gaming_users, 0) as gaming_users,
    COALESCE(dau.android_users, 0) as android_users,
    COALESCE(dau.ios_users, 0) as ios_users,
    -- Revenue metrics
    COALESCE(dr.total_revenue_usd, 0) as daily_revenue,
    COALESCE(dr.total_purchases, 0) as daily_purchases,
    COALESCE(dr.paying_users, 0) as paying_users,
    COALESCE(dr.avg_purchase_value, 0) as avg_purchase_value,
    -- Engagement metrics
    COALESCE(de.avg_games_per_session, 0) as avg_games_per_session,
    COALESCE(de.avg_session_duration_minutes, 0) as avg_session_duration,
    COALESCE(de.high_engagement_rate, 0) as high_engagement_rate,
    -- Quality metrics
    COALESCE(dc.total_errors, 0) as daily_crashes,
    COALESCE(dc.affected_users, 0) as crash_affected_users,
    -- Monetization
    COALESCE(dmf.ad_completion_rate, 0) as ad_completion_rate,
    COALESCE(dmf.ads_shown, 0) as ads_shown,
    -- Calculated KPIs
    CASE 
        WHEN COALESCE(dau.dau, 0) > 0 
        THEN ROUND(COALESCE(dr.total_revenue_usd, 0) / dau.dau, 4)
        ELSE 0 
    END as arpu,
    CASE 
        WHEN COALESCE(dr.paying_users, 0) > 0 
        THEN ROUND(COALESCE(dr.total_revenue_usd, 0) / dr.paying_users, 2)
        ELSE 0 
    END as arppu,
    CASE 
        WHEN COALESCE(dau.dau, 0) > 0 
        THEN ROUND(COALESCE(dr.paying_users, 0)::numeric / dau.dau * 100, 2)
        ELSE 0 
    END as conversion_rate
FROM (
    SELECT DISTINCT DATE(created_at) as date 
    FROM analytics_events 
    WHERE created_at >= CURRENT_DATE - INTERVAL '60 days'
) d
LEFT JOIN daily_active_users dau ON d.date = dau.date
LEFT JOIN daily_revenue dr ON d.date = dr.date
LEFT JOIN daily_engagement de ON d.date = de.date
LEFT JOIN daily_crashes dc ON d.date = dc.date
LEFT JOIN daily_monetization_funnel dmf ON d.date = dmf.date
ORDER BY d.date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_kpi_summary_date ON daily_kpi_summary (date);

-- ============================================================================
-- REFRESH FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION refresh_daily_kpi_views()
RETURNS void AS $$
BEGIN
    -- Refresh all materialized views concurrently for better performance
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_active_users;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;
    REFRESH MATERIALIZED VIEW CONCURRENTLY retention_cohorts;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_crashes;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_engagement;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_monetization_funnel;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_kpi_summary;
    
    -- Log the refresh
    INSERT INTO analytics_events (event_name, event_category, parameters)
    VALUES ('kpi_dashboard_refreshed', 'system', jsonb_build_object('timestamp', NOW()));
    
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================
COMMENT ON MATERIALIZED VIEW daily_active_users IS 'Daily active user metrics with platform breakdown';
COMMENT ON MATERIALIZED VIEW daily_revenue IS 'Daily revenue and purchase metrics';
COMMENT ON MATERIALIZED VIEW retention_cohorts IS 'User retention analysis by install cohort';
COMMENT ON MATERIALIZED VIEW daily_crashes IS 'Daily crash and error tracking';
COMMENT ON MATERIALIZED VIEW daily_engagement IS 'Daily user engagement and session quality metrics';
COMMENT ON MATERIALIZED VIEW daily_monetization_funnel IS 'Ad and IAP conversion funnel metrics';
COMMENT ON MATERIALIZED VIEW daily_kpi_summary IS 'Main KPI dashboard summary with calculated metrics';
COMMENT ON FUNCTION refresh_daily_kpi_views() IS 'Refreshes all KPI materialized views - run twice daily';
