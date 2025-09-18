-- 📊 User Analytics Schema - Comprehensive User Tracking
-- This schema tracks all user behavior and statistics for business intelligence

-- Create user_analytics table with comprehensive tracking
CREATE TABLE IF NOT EXISTS user_analytics (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    
    -- Install & Session Data
    install_date TIMESTAMP WITH TIME ZONE NOT NULL,
    number_of_sessions INTEGER DEFAULT 0,
    total_play_time_seconds INTEGER DEFAULT 0,
    last_session_date TIMESTAMP WITH TIME ZONE,
    session_streak INTEGER DEFAULT 0,
    
    -- Game Performance Data
    number_of_games INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    high_score INTEGER DEFAULT 0,
    total_score BIGINT DEFAULT 0,
    average_score DECIMAL(10,2) DEFAULT 0.0,
    
    -- Progression Data
    daily_missions_completed INTEGER DEFAULT 0,
    achievements_completed INTEGER DEFAULT 0,
    total_achievement_points INTEGER DEFAULT 0,
    
    -- Monetization Data
    number_of_purchases INTEGER DEFAULT 0,
    total_spent_usd DECIMAL(10,2) DEFAULT 0.0,
    number_of_continues_used INTEGER DEFAULT 0,
    total_gems_spent INTEGER DEFAULT 0,
    total_coins_spent INTEGER DEFAULT 0,
    
    -- Inventory Data
    jets_owned INTEGER DEFAULT 1,
    owned_jet_ids TEXT[] DEFAULT ARRAY['sky_jet'],
    current_jet_id VARCHAR(50) DEFAULT 'sky_jet',
    skins_owned INTEGER DEFAULT 1,
    
    -- Device & Location Data
    device_model VARCHAR(255),
    os_version VARCHAR(100),
    platform VARCHAR(20),
    country_code VARCHAR(5),
    timezone VARCHAR(50),
    app_version VARCHAR(20),
    
    -- Engagement Data
    ad_watch_count INTEGER DEFAULT 0,
    share_count INTEGER DEFAULT 0,
    rate_us_prompt_shown INTEGER DEFAULT 0,
    has_rated_app BOOLEAN DEFAULT FALSE,
    crash_count INTEGER DEFAULT 0,
    last_crash_date TIMESTAMP WITH TIME ZONE,
    
    -- Behavioral Data (JSON fields for flexibility)
    feature_usage JSONB DEFAULT '{}',
    level_completion_times JSONB DEFAULT '{}',
    tutorial_completed INTEGER DEFAULT 0,
    preferred_play_times TEXT[] DEFAULT ARRAY[]::TEXT[],
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(player_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_analytics_player_id ON user_analytics(player_id);
CREATE INDEX IF NOT EXISTS idx_user_analytics_install_date ON user_analytics(install_date);
CREATE INDEX IF NOT EXISTS idx_user_analytics_platform ON user_analytics(platform);
CREATE INDEX IF NOT EXISTS idx_user_analytics_country ON user_analytics(country_code);
CREATE INDEX IF NOT EXISTS idx_user_analytics_high_score ON user_analytics(high_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_analytics_total_spent ON user_analytics(total_spent_usd DESC);
CREATE INDEX IF NOT EXISTS idx_user_analytics_sessions ON user_analytics(number_of_sessions DESC);
CREATE INDEX IF NOT EXISTS idx_user_analytics_updated_at ON user_analytics(updated_at DESC);

-- Create analytics events table for detailed event tracking
CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(255) REFERENCES players(id) ON DELETE CASCADE,
    event_name VARCHAR(100) NOT NULL,
    event_data JSONB,
    session_id VARCHAR(255),
    platform VARCHAR(20),
    app_version VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for analytics events
CREATE INDEX IF NOT EXISTS idx_analytics_events_player_id ON analytics_events(player_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_platform ON analytics_events(platform);

-- Create user cohorts table for retention analysis
CREATE TABLE IF NOT EXISTS user_cohorts (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(255) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    install_week DATE NOT NULL, -- Week of installation (Monday of that week)
    install_month DATE NOT NULL, -- Month of installation (1st of that month)
    install_quarter DATE NOT NULL, -- Quarter of installation
    ltv_day_1 DECIMAL(10,2) DEFAULT 0.0,
    ltv_day_7 DECIMAL(10,2) DEFAULT 0.0,
    ltv_day_30 DECIMAL(10,2) DEFAULT 0.0,
    ltv_day_90 DECIMAL(10,2) DEFAULT 0.0,
    retention_day_1 BOOLEAN DEFAULT FALSE,
    retention_day_7 BOOLEAN DEFAULT FALSE,
    retention_day_30 BOOLEAN DEFAULT FALSE,
    retention_day_90 BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(player_id)
);

-- Create indexes for cohort analysis
CREATE INDEX IF NOT EXISTS idx_user_cohorts_install_week ON user_cohorts(install_week);
CREATE INDEX IF NOT EXISTS idx_user_cohorts_install_month ON user_cohorts(install_month);
CREATE INDEX IF NOT EXISTS idx_user_cohorts_ltv_day_30 ON user_cohorts(ltv_day_30 DESC);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_user_analytics_updated_at 
    BEFORE UPDATE ON user_analytics 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_cohorts_updated_at 
    BEFORE UPDATE ON user_cohorts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create materialized view for daily analytics summary
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_analytics_summary AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT player_id) as daily_active_users,
    COUNT(*) as total_events,
    COUNT(DISTINCT CASE WHEN event_name = 'game_start' THEN player_id END) as players_who_played,
    COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) as total_games_played,
    COUNT(CASE WHEN event_name = 'iap_purchase' THEN 1 END) as total_purchases,
    SUM(CASE WHEN event_name = 'iap_purchase' THEN (event_data->>'price_usd')::DECIMAL ELSE 0 END) as total_revenue,
    COUNT(CASE WHEN event_name = 'continue_used' THEN 1 END) as total_continues_used,
    COUNT(CASE WHEN event_name = 'rewarded_ad_watched' THEN 1 END) as total_ads_watched
FROM analytics_events
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Create unique index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_analytics_summary_date ON daily_analytics_summary(date);

-- Create materialized view for user segments
CREATE MATERIALIZED VIEW IF NOT EXISTS user_segments AS
SELECT 
    ua.player_id,
    ua.platform,
    ua.country_code,
    ua.install_date,
    ua.number_of_sessions,
    ua.total_play_time_seconds,
    ua.high_score,
    ua.total_spent_usd,
    ua.number_of_purchases,
    CASE 
        WHEN ua.total_spent_usd > 50 THEN 'whale'
        WHEN ua.total_spent_usd > 10 THEN 'dolphin'
        WHEN ua.total_spent_usd > 0 THEN 'minnow'
        ELSE 'free'
    END as spending_segment,
    CASE 
        WHEN ua.number_of_sessions >= 100 THEN 'hardcore'
        WHEN ua.number_of_sessions >= 20 THEN 'regular'
        WHEN ua.number_of_sessions >= 5 THEN 'casual'
        ELSE 'new'
    END as engagement_segment,
    CASE 
        WHEN ua.high_score >= 1000 THEN 'expert'
        WHEN ua.high_score >= 500 THEN 'intermediate'
        WHEN ua.high_score >= 100 THEN 'beginner'
        ELSE 'novice'
    END as skill_segment
FROM user_analytics ua;

-- Create indexes on user segments
CREATE INDEX IF NOT EXISTS idx_user_segments_spending ON user_segments(spending_segment);
CREATE INDEX IF NOT EXISTS idx_user_segments_engagement ON user_segments(engagement_segment);
CREATE INDEX IF NOT EXISTS idx_user_segments_skill ON user_segments(skill_segment);

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_analytics_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_segments;
    
    -- Log the refresh
    INSERT INTO system_logs (level, message, created_at) 
    VALUES ('INFO', 'Analytics materialized views refreshed', NOW());
END;
$$ LANGUAGE plpgsql;

-- Create system_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Function to calculate user cohort metrics
CREATE OR REPLACE FUNCTION update_user_cohort_metrics(target_player_id VARCHAR(255))
RETURNS void AS $$
DECLARE
    install_date DATE;
    current_ltv DECIMAL(10,2);
    days_since_install INTEGER;
BEGIN
    -- Get user's install date
    SELECT DATE(ua.install_date) INTO install_date
    FROM user_analytics ua
    WHERE ua.player_id = target_player_id;
    
    IF install_date IS NULL THEN
        RETURN;
    END IF;
    
    days_since_install := DATE_PART('day', NOW() - install_date);
    
    -- Calculate current LTV
    SELECT COALESCE(ua.total_spent_usd, 0) INTO current_ltv
    FROM user_analytics ua
    WHERE ua.player_id = target_player_id;
    
    -- Insert or update cohort record
    INSERT INTO user_cohorts (
        player_id, 
        install_week, 
        install_month, 
        install_quarter,
        ltv_day_1,
        ltv_day_7,
        ltv_day_30,
        ltv_day_90,
        retention_day_1,
        retention_day_7,
        retention_day_30,
        retention_day_90
    ) VALUES (
        target_player_id,
        DATE_TRUNC('week', install_date)::DATE,
        DATE_TRUNC('month', install_date)::DATE,
        DATE_TRUNC('quarter', install_date)::DATE,
        CASE WHEN days_since_install >= 1 THEN current_ltv ELSE 0 END,
        CASE WHEN days_since_install >= 7 THEN current_ltv ELSE 0 END,
        CASE WHEN days_since_install >= 30 THEN current_ltv ELSE 0 END,
        CASE WHEN days_since_install >= 90 THEN current_ltv ELSE 0 END,
        days_since_install >= 1,
        days_since_install >= 7,
        days_since_install >= 30,
        days_since_install >= 90
    )
    ON CONFLICT (player_id) DO UPDATE SET
        ltv_day_1 = CASE WHEN days_since_install >= 1 THEN current_ltv ELSE user_cohorts.ltv_day_1 END,
        ltv_day_7 = CASE WHEN days_since_install >= 7 THEN current_ltv ELSE user_cohorts.ltv_day_7 END,
        ltv_day_30 = CASE WHEN days_since_install >= 30 THEN current_ltv ELSE user_cohorts.ltv_day_30 END,
        ltv_day_90 = CASE WHEN days_since_install >= 90 THEN current_ltv ELSE user_cohorts.ltv_day_90 END,
        retention_day_1 = days_since_install >= 1 OR user_cohorts.retention_day_1,
        retention_day_7 = days_since_install >= 7 OR user_cohorts.retention_day_7,
        retention_day_30 = days_since_install >= 30 OR user_cohorts.retention_day_30,
        retention_day_90 = days_since_install >= 90 OR user_cohorts.retention_day_90,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically update cohort metrics when user_analytics is updated
CREATE OR REPLACE FUNCTION trigger_update_cohort_metrics()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_user_cohort_metrics(NEW.player_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cohort_metrics_trigger
    AFTER INSERT OR UPDATE ON user_analytics
    FOR EACH ROW EXECUTE FUNCTION trigger_update_cohort_metrics();

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON user_analytics TO your_app_user;
-- GRANT SELECT, INSERT ON analytics_events TO your_app_user;
-- GRANT SELECT ON daily_analytics_summary TO your_app_user;
-- GRANT SELECT ON user_segments TO your_app_user;
