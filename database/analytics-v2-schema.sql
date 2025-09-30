-- 📊 Enhanced Analytics Database Schema v2
-- Comprehensive schema for all 16 KPIs with Railway Pro optimizations
-- Backward compatible with existing v1 schema

-- ============================================================================
-- ANALYTICS EVENTS V2 TABLE - Enhanced event tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics_events_v2 (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(255),
    event_name VARCHAR(100) NOT NULL,
    event_category VARCHAR(50) NOT NULL DEFAULT 'other',
    event_priority VARCHAR(20) NOT NULL DEFAULT 'low',
    parameters JSONB NOT NULL DEFAULT '{}',
    session_id VARCHAR(255),
    user_type VARCHAR(50) DEFAULT 'unknown',
    platform VARCHAR(20) DEFAULT 'unknown',
    app_version VARCHAR(20) DEFAULT '1.4.9',
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enhanced indexes for Railway Pro performance
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_player_id ON analytics_events_v2(player_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_event_name ON analytics_events_v2(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_event_category ON analytics_events_v2(event_category);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_session_id ON analytics_events_v2(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_created_at ON analytics_events_v2(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_platform ON analytics_events_v2(platform);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_user_type ON analytics_events_v2(user_type);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_player_date ON analytics_events_v2(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_event_date ON analytics_events_v2(event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_category_date ON analytics_events_v2(event_category, created_at);

-- Partial indexes for specific event types
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_session_events ON analytics_events_v2(player_id, session_id) WHERE event_name IN ('session_start', 'session_end');
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_gameplay_events ON analytics_events_v2(player_id, created_at) WHERE event_name IN ('game_start', 'game_end', 'mission_complete', 'achievement_unlock');
CREATE INDEX IF NOT EXISTS idx_analytics_events_v2_monetization_events ON analytics_events_v2(player_id, created_at) WHERE event_name IN ('iap_purchase', 'ad_shown', 'ad_completed', 'ad_abandoned', 'continue_used');

-- ============================================================================
-- USER ANALYTICS V2 TABLE - Comprehensive user-level metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_analytics_v2 (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(255) UNIQUE NOT NULL,
    
    -- User lifecycle
    install_date DATE NOT NULL,
    last_seen_date DATE,
    total_sessions INTEGER DEFAULT 0,
    total_play_time_seconds INTEGER DEFAULT 0,
    
    -- Gameplay metrics
    total_games_played INTEGER DEFAULT 0,
    best_score INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    games_per_session_avg DECIMAL(5,2) DEFAULT 0,
    
    -- Mission and achievement metrics
    missions_completed INTEGER DEFAULT 0,
    daily_missions_completed INTEGER DEFAULT 0,
    all_daily_missions_completed_count INTEGER DEFAULT 0,
    achievements_unlocked INTEGER DEFAULT 0,
    avg_achievements_per_user DECIMAL(5,2) DEFAULT 0,
    
    -- Continue usage metrics
    continues_used_total INTEGER DEFAULT 0,
    continues_via_ad INTEGER DEFAULT 0,
    continues_via_gems INTEGER DEFAULT 0,
    avg_continues_per_user DECIMAL(5,2) DEFAULT 0,
    
    -- Ad metrics
    ads_shown_total INTEGER DEFAULT 0,
    ads_completed_total INTEGER DEFAULT 0,
    ads_abandoned_total INTEGER DEFAULT 0,
    ad_completion_rate DECIMAL(5,2) DEFAULT 0,
    
    -- Currency metrics
    coins_earned_total INTEGER DEFAULT 0,
    gems_earned_total INTEGER DEFAULT 0,
    coins_spent_total INTEGER DEFAULT 0,
    gems_spent_total INTEGER DEFAULT 0,
    
    -- Revenue metrics
    total_purchases INTEGER DEFAULT 0,
    total_revenue_usd DECIMAL(10,2) DEFAULT 0,
    arpu DECIMAL(10,4) DEFAULT 0,
    arppu DECIMAL(10,2) DEFAULT 0,
    
    -- Retention metrics
    day1_retained BOOLEAN DEFAULT FALSE,
    day7_retained BOOLEAN DEFAULT FALSE,
    day30_retained BOOLEAN DEFAULT FALSE,
    retention_cohort_week DATE,
    
    -- Device and platform info
    platform VARCHAR(20),
    app_version VARCHAR(20),
    device_model VARCHAR(100),
    
    -- Engagement metrics
    high_engagement_sessions INTEGER DEFAULT 0,
    avg_session_duration_seconds INTEGER DEFAULT 0,
    
    -- Error tracking
    total_errors INTEGER DEFAULT 0,
    fatal_errors INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for user analytics v2
CREATE INDEX IF NOT EXISTS idx_user_analytics_v2_player_id ON user_analytics_v2(player_id);
CREATE INDEX IF NOT EXISTS idx_user_analytics_v2_install_date ON user_analytics_v2(install_date);
CREATE INDEX IF NOT EXISTS idx_user_analytics_v2_last_seen ON user_analytics_v2(last_seen_date);
CREATE INDEX IF NOT EXISTS idx_user_analytics_v2_platform ON user_analytics_v2(platform);
CREATE INDEX IF NOT EXISTS idx_user_analytics_v2_retention_cohort ON user_analytics_v2(retention_cohort_week);
CREATE INDEX IF NOT EXISTS idx_user_analytics_v2_paying_users ON user_analytics_v2(player_id) WHERE total_purchases > 0;

-- ============================================================================
-- DAILY KPI VIEWS V2 - Materialized views for dashboard performance
-- ============================================================================

-- Daily Active Users (DAU) view
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_active_users_v2 AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT player_id) as dau,
    COUNT(DISTINCT CASE WHEN event_name = 'session_start' THEN player_id END) as session_users,
    COUNT(DISTINCT CASE WHEN event_name = 'game_start' THEN player_id END) as gaming_users,
    COUNT(DISTINCT CASE WHEN platform = 'android' THEN player_id END) as android_users,
    COUNT(DISTINCT CASE WHEN platform = 'ios' THEN player_id END) as ios_users
FROM analytics_events_v2
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Daily Revenue view
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_revenue_v2 AS
SELECT 
    DATE(created_at) as date,
    COUNT(CASE WHEN event_name = 'iap_purchase' THEN 1 END) as total_purchases,
    COUNT(DISTINCT CASE WHEN event_name = 'iap_purchase' THEN player_id END) as paying_users,
    SUM(CASE WHEN event_name = 'iap_purchase' THEN (parameters->>'price_usd')::decimal ELSE 0 END) as total_revenue_usd,
    COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'gems' THEN 1 END) as gem_purchases,
    COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'hearts' THEN 1 END) as heart_purchases,
    COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'jet' THEN 1 END) as jet_purchases,
    COUNT(CASE WHEN event_name = 'iap_purchase' AND parameters->>'product_type' = 'remove_ads' THEN 1 END) as remove_ads_purchases
FROM analytics_events_v2
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Daily Engagement view
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_engagement_v2 AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT session_id) as total_sessions,
    COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) as total_games,
    ROUND(AVG(CASE WHEN event_name = 'session_end' THEN (parameters->>'session_duration_seconds')::int END), 2) as avg_session_duration,
    ROUND(AVG(CASE WHEN event_name = 'game_start' THEN (parameters->>'games_in_session')::int END), 2) as avg_games_per_session,
    COUNT(CASE WHEN event_name = 'session_end' AND (parameters->>'session_duration_seconds')::int > 300 THEN 1 END) as high_engagement_sessions
FROM analytics_events_v2
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Daily Missions and Achievements view
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_missions_achievements_v2 AS
SELECT 
    DATE(created_at) as date,
    COUNT(CASE WHEN event_name = 'mission_complete' THEN 1 END) as missions_completed,
    COUNT(DISTINCT CASE WHEN event_name = 'mission_complete' THEN player_id END) as users_completed_missions,
    COUNT(CASE WHEN event_name = 'daily_mission_cycle_complete' AND (parameters->>'all_missions_completed')::boolean THEN 1 END) as users_all_missions,
    COUNT(CASE WHEN event_name = 'achievement_unlock' THEN 1 END) as achievements_unlocked,
    COUNT(DISTINCT CASE WHEN event_name = 'achievement_unlock' THEN player_id END) as users_unlocked_achievements,
    ROUND(AVG(CASE WHEN event_name = 'achievement_unlock' THEN (parameters->>'achievements_count')::int END), 2) as avg_achievements_per_user
FROM analytics_events_v2
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Daily Monetization Funnel view
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_monetization_funnel_v2 AS
SELECT 
    DATE(created_at) as date,
    COUNT(CASE WHEN event_name = 'ad_shown' THEN 1 END) as ads_shown,
    COUNT(CASE WHEN event_name = 'ad_completed' THEN 1 END) as ads_completed,
    COUNT(CASE WHEN event_name = 'ad_abandoned' THEN 1 END) as ads_abandoned,
    COUNT(CASE WHEN event_name = 'continue_used' THEN 1 END) as continues_used,
    COUNT(CASE WHEN event_name = 'continue_used' AND parameters->>'continue_type' = 'ad' THEN 1 END) as continues_via_ad,
    COUNT(CASE WHEN event_name = 'continue_used' AND parameters->>'continue_type' = 'gems' THEN 1 END) as continues_via_gems,
    CASE WHEN COUNT(CASE WHEN event_name = 'ad_shown' THEN 1 END) > 0 
         THEN ROUND(COUNT(CASE WHEN event_name = 'ad_completed' THEN 1 END)::numeric / COUNT(CASE WHEN event_name = 'ad_shown' THEN 1 END) * 100, 2) 
         ELSE 0 END as ad_completion_rate
FROM analytics_events_v2
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Daily Currency Tracking view
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_currency_v2 AS
SELECT 
    DATE(created_at) as date,
    SUM(CASE WHEN event_name = 'currency_earned' AND parameters->>'currency_type' = 'coins' THEN (parameters->>'amount')::int ELSE 0 END) as coins_earned,
    SUM(CASE WHEN event_name = 'currency_earned' AND parameters->>'currency_type' = 'gems' THEN (parameters->>'amount')::int ELSE 0 END) as gems_earned,
    SUM(CASE WHEN event_name = 'currency_spent' AND parameters->>'currency_type' = 'coins' THEN (parameters->>'amount')::int ELSE 0 END) as coins_spent,
    SUM(CASE WHEN event_name = 'currency_spent' AND parameters->>'currency_type' = 'gems' THEN (parameters->>'amount')::int ELSE 0 END) as gems_spent
FROM analytics_events_v2
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Daily KPI Summary view (combines all metrics)
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_kpi_summary_v2 AS
SELECT 
    dau.date,
    dau.dau,
    dau.session_users,
    dau.gaming_users,
    dau.android_users,
    dau.ios_users,
    
    eng.total_sessions,
    eng.total_games,
    eng.avg_session_duration,
    eng.avg_games_per_session,
    eng.high_engagement_sessions,
    
    rev.total_purchases,
    rev.paying_users,
    rev.total_revenue_usd,
    rev.gem_purchases,
    rev.heart_purchases,
    rev.jet_purchases,
    rev.remove_ads_purchases,
    
    ma.missions_completed,
    ma.users_completed_missions,
    ma.users_all_missions,
    ma.achievements_unlocked,
    ma.users_unlocked_achievements,
    ma.avg_achievements_per_user,
    
    mf.ads_shown,
    mf.ads_completed,
    mf.ads_abandoned,
    mf.continues_used,
    mf.continues_via_ad,
    mf.continues_via_gems,
    mf.ad_completion_rate,
    
    curr.coins_earned,
    curr.gems_earned,
    curr.coins_spent,
    curr.gems_spent,
    
    -- Calculated metrics
    CASE WHEN dau.dau > 0 THEN ROUND(rev.total_revenue_usd / dau.dau, 4) ELSE 0 END as arpu,
    CASE WHEN rev.paying_users > 0 THEN ROUND(rev.total_revenue_usd / rev.paying_users, 2) ELSE 0 END as arppu,
    CASE WHEN dau.dau > 0 THEN ROUND(mf.continues_used::numeric / dau.dau, 2) ELSE 0 END as avg_continues_per_user,
    CASE WHEN ma.users_completed_missions > 0 THEN ROUND(ma.users_all_missions::numeric / ma.users_completed_missions * 100, 2) ELSE 0 END as mission_completion_rate
    
FROM daily_active_users_v2 dau
LEFT JOIN daily_revenue_v2 rev ON dau.date = rev.date
LEFT JOIN daily_engagement_v2 eng ON dau.date = eng.date
LEFT JOIN daily_missions_achievements_v2 ma ON dau.date = ma.date
LEFT JOIN daily_monetization_funnel_v2 mf ON dau.date = mf.date
LEFT JOIN daily_currency_v2 curr ON dau.date = curr.date
ORDER BY dau.date DESC;

-- ============================================================================
-- RETENTION COHORTS V2 - Enhanced retention analysis
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS retention_cohorts_v2 AS
WITH user_cohorts AS (
    SELECT 
        player_id,
        DATE(MIN(created_at)) as install_date,
        DATE_TRUNC('week', MIN(created_at))::DATE as install_week
    FROM analytics_events_v2
    WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY player_id
),
retention_events AS (
    SELECT 
        uc.player_id,
        uc.install_date,
        uc.install_week,
        DATE(ae.created_at) as activity_date,
        DATE(ae.created_at) - uc.install_date as days_since_install
    FROM user_cohorts uc
    JOIN analytics_events_v2 ae ON uc.player_id = ae.player_id
    WHERE ae.created_at >= CURRENT_DATE - INTERVAL '90 days'
)
SELECT 
    install_week,
    COUNT(DISTINCT player_id) as cohort_size,
    COUNT(DISTINCT CASE WHEN days_since_install = 1 THEN player_id END) as day1_retained,
    COUNT(DISTINCT CASE WHEN days_since_install = 7 THEN player_id END) as day7_retained,
    COUNT(DISTINCT CASE WHEN days_since_install = 30 THEN player_id END) as day30_retained,
    ROUND(
        COUNT(DISTINCT CASE WHEN days_since_install = 1 THEN player_id END)::numeric / 
        COUNT(DISTINCT player_id) * 100, 2
    ) as day1_retention_rate,
    ROUND(
        COUNT(DISTINCT CASE WHEN days_since_install = 7 THEN player_id END)::numeric / 
        COUNT(DISTINCT player_id) * 100, 2
    ) as day7_retention_rate,
    ROUND(
        COUNT(DISTINCT CASE WHEN days_since_install = 30 THEN player_id END)::numeric / 
        COUNT(DISTINCT player_id) * 100, 2
    ) as day30_retention_rate
FROM retention_events
GROUP BY install_week
HAVING COUNT(DISTINCT player_id) >= 5
ORDER BY install_week DESC;

-- ============================================================================
-- REFRESH FUNCTIONS - Automated view refresh
-- ============================================================================

-- Function to refresh all v2 materialized views
CREATE OR REPLACE FUNCTION refresh_daily_kpi_views_v2()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW daily_active_users_v2;
    REFRESH MATERIALIZED VIEW daily_revenue_v2;
    REFRESH MATERIALIZED VIEW daily_engagement_v2;
    REFRESH MATERIALIZED VIEW daily_missions_achievements_v2;
    REFRESH MATERIALIZED VIEW daily_monetization_funnel_v2;
    REFRESH MATERIALIZED VIEW daily_currency_v2;
    REFRESH MATERIALIZED VIEW daily_kpi_summary_v2;
    REFRESH MATERIALIZED VIEW retention_cohorts_v2;
    
    RAISE NOTICE 'All v2 KPI views refreshed successfully';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS AND AUTOMATION
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column_v2()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_analytics_events_v2_updated_at 
    BEFORE UPDATE ON analytics_events_v2 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column_v2();

CREATE TRIGGER update_user_analytics_v2_updated_at 
    BEFORE UPDATE ON user_analytics_v2 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column_v2();

-- Function to update user analytics when events are inserted
CREATE OR REPLACE FUNCTION update_user_analytics_v2()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update user analytics based on event
    INSERT INTO user_analytics_v2 (
        player_id, install_date, last_seen_date, platform, app_version,
        total_sessions, total_games_played, total_play_time_seconds,
        missions_completed, achievements_unlocked, continues_used_total,
        ads_shown_total, ads_completed_total, ads_abandoned_total,
        coins_earned_total, gems_earned_total, coins_spent_total, gems_spent_total,
        total_purchases, total_revenue_usd
    )
    VALUES (
        NEW.player_id,
        COALESCE((SELECT install_date FROM user_analytics_v2 WHERE player_id = NEW.player_id), CURRENT_DATE),
        CURRENT_DATE,
        NEW.platform,
        NEW.app_version,
        CASE WHEN NEW.event_name = 'session_start' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'game_start' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'session_end' THEN COALESCE((NEW.parameters->>'session_duration_seconds')::int, 0) ELSE 0 END,
        CASE WHEN NEW.event_name = 'mission_complete' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'achievement_unlock' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'continue_used' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'ad_shown' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'ad_completed' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'ad_abandoned' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'currency_earned' AND NEW.parameters->>'currency_type' = 'coins' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        CASE WHEN NEW.event_name = 'currency_earned' AND NEW.parameters->>'currency_type' = 'gems' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        CASE WHEN NEW.event_name = 'currency_spent' AND NEW.parameters->>'currency_type' = 'coins' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        CASE WHEN NEW.event_name = 'currency_spent' AND NEW.parameters->>'currency_type' = 'gems' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        CASE WHEN NEW.event_name = 'iap_purchase' THEN 1 ELSE 0 END,
        CASE WHEN NEW.event_name = 'iap_purchase' THEN COALESCE((NEW.parameters->>'price_usd')::decimal, 0) ELSE 0 END
    )
    ON CONFLICT (player_id) DO UPDATE SET
        last_seen_date = CURRENT_DATE,
        total_sessions = user_analytics_v2.total_sessions + CASE WHEN NEW.event_name = 'session_start' THEN 1 ELSE 0 END,
        total_games_played = user_analytics_v2.total_games_played + CASE WHEN NEW.event_name = 'game_start' THEN 1 ELSE 0 END,
        total_play_time_seconds = user_analytics_v2.total_play_time_seconds + CASE WHEN NEW.event_name = 'session_end' THEN COALESCE((NEW.parameters->>'session_duration_seconds')::int, 0) ELSE 0 END,
        missions_completed = user_analytics_v2.missions_completed + CASE WHEN NEW.event_name = 'mission_complete' THEN 1 ELSE 0 END,
        achievements_unlocked = user_analytics_v2.achievements_unlocked + CASE WHEN NEW.event_name = 'achievement_unlock' THEN 1 ELSE 0 END,
        continues_used_total = user_analytics_v2.continues_used_total + CASE WHEN NEW.event_name = 'continue_used' THEN 1 ELSE 0 END,
        ads_shown_total = user_analytics_v2.ads_shown_total + CASE WHEN NEW.event_name = 'ad_shown' THEN 1 ELSE 0 END,
        ads_completed_total = user_analytics_v2.ads_completed_total + CASE WHEN NEW.event_name = 'ad_completed' THEN 1 ELSE 0 END,
        ads_abandoned_total = user_analytics_v2.ads_abandoned_total + CASE WHEN NEW.event_name = 'ad_abandoned' THEN 1 ELSE 0 END,
        coins_earned_total = user_analytics_v2.coins_earned_total + CASE WHEN NEW.event_name = 'currency_earned' AND NEW.parameters->>'currency_type' = 'coins' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        gems_earned_total = user_analytics_v2.gems_earned_total + CASE WHEN NEW.event_name = 'currency_earned' AND NEW.parameters->>'currency_type' = 'gems' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        coins_spent_total = user_analytics_v2.coins_spent_total + CASE WHEN NEW.event_name = 'currency_spent' AND NEW.parameters->>'currency_type' = 'coins' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        gems_spent_total = user_analytics_v2.gems_spent_total + CASE WHEN NEW.event_name = 'currency_spent' AND NEW.parameters->>'currency_type' = 'gems' THEN COALESCE((NEW.parameters->>'amount')::int, 0) ELSE 0 END,
        total_purchases = user_analytics_v2.total_purchases + CASE WHEN NEW.event_name = 'iap_purchase' THEN 1 ELSE 0 END,
        total_revenue_usd = user_analytics_v2.total_revenue_usd + CASE WHEN NEW.event_name = 'iap_purchase' THEN COALESCE((NEW.parameters->>'price_usd')::decimal, 0) ELSE 0 END,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update user analytics
CREATE TRIGGER trigger_update_user_analytics_v2
    AFTER INSERT ON analytics_events_v2
    FOR EACH ROW EXECUTE FUNCTION update_user_analytics_v2();

-- ============================================================================
-- SCHEDULED REFRESH - Automated view refresh (Railway Pro feature)
-- ============================================================================

-- Create a function to schedule view refreshes
CREATE OR REPLACE FUNCTION schedule_kpi_refresh_v2()
RETURNS void AS $$
BEGIN
    -- This would typically be handled by Railway's cron jobs or pg_cron extension
    -- For now, we'll create a manual refresh function
    PERFORM refresh_daily_kpi_views_v2();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANTS AND PERMISSIONS
-- ============================================================================

-- Grant necessary permissions for the application
GRANT SELECT, INSERT, UPDATE ON analytics_events_v2 TO flappyjet_app;
GRANT SELECT, INSERT, UPDATE ON user_analytics_v2 TO flappyjet_app;
GRANT SELECT ON daily_kpi_summary_v2 TO flappyjet_app;
GRANT SELECT ON retention_cohorts_v2 TO flappyjet_app;
GRANT EXECUTE ON FUNCTION refresh_daily_kpi_views_v2() TO flappyjet_app;

-- Grant permissions for dashboard access
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_user;
GRANT SELECT ON ALL MATERIALIZED VIEWS IN SCHEMA public TO dashboard_user;
GRANT EXECUTE ON FUNCTION refresh_daily_kpi_views_v2() TO dashboard_user;
