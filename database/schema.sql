-- 🐘 FlappyJet Pro - PostgreSQL Database Schema
-- Production-ready schema for Railway deployment

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Players table - Core player data
CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) UNIQUE NOT NULL,
    nickname VARCHAR(50) NOT NULL DEFAULT 'Pilot',
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Game stats
    best_score INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    total_games_played INTEGER DEFAULT 0,
    total_coins_earned INTEGER DEFAULT 0,
    total_gems_earned INTEGER DEFAULT 0,
    
    -- Current resources
    current_coins INTEGER DEFAULT 500, -- NEW PLAYER BONUS
    current_gems INTEGER DEFAULT 25,   -- NEW PLAYER BONUS
    current_hearts INTEGER DEFAULT 3,
    hearts_last_regen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Premium features
    heart_booster_expiry TIMESTAMP WITH TIME ZONE,
    is_premium BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    platform VARCHAR(20) DEFAULT 'unknown', -- 'ios', 'android', 'web'
    app_version VARCHAR(20) DEFAULT '1.0.0',
    country_code VARCHAR(2),
    timezone VARCHAR(50),
    
    -- Flags
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    privacy_consent BOOLEAN DEFAULT FALSE,
    
    CONSTRAINT valid_nickname CHECK (LENGTH(nickname) >= 1),
    CONSTRAINT valid_score CHECK (best_score >= 0),
    CONSTRAINT valid_resources CHECK (
        current_coins >= 0 AND 
        current_gems >= 0 AND 
        current_hearts >= 0 AND 
        current_hearts <= 10
    )
);

-- Scores table - All game scores for leaderboards
CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    survival_time INTEGER NOT NULL, -- seconds
    skin_used VARCHAR(50) NOT NULL DEFAULT 'sky_jet',
    coins_earned INTEGER DEFAULT 0,
    gems_earned INTEGER DEFAULT 0,
    difficulty_phase INTEGER DEFAULT 1,
    
    -- Anti-cheat data
    game_duration INTEGER NOT NULL, -- milliseconds
    actions_per_second DECIMAL(5,2),
    suspicious_flags TEXT[], -- Array of potential cheat indicators
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    
    CONSTRAINT valid_score_data CHECK (
        score >= 0 AND 
        survival_time >= 0 AND 
        game_duration > 0 AND
        coins_earned >= 0 AND
        gems_earned >= 0
    )
);

-- Player inventory - Skins and items
CREATE TABLE player_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_type VARCHAR(20) NOT NULL, -- 'skin', 'booster', 'currency'
    item_id VARCHAR(50) NOT NULL,
    quantity INTEGER DEFAULT 1,
    equipped BOOLEAN DEFAULT FALSE,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    acquired_method VARCHAR(20) DEFAULT 'purchase', -- 'purchase', 'reward', 'gift'
    
    UNIQUE(player_id, item_id),
    CONSTRAINT valid_quantity CHECK (quantity >= 0)
);

-- Missions system - Adaptive daily missions
CREATE TABLE missions_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mission_type VARCHAR(30) NOT NULL, -- 'play_games', 'reach_score', etc.
    difficulty_level VARCHAR(20) NOT NULL, -- 'easy', 'medium', 'hard', 'expert'
    title_template VARCHAR(100) NOT NULL,
    description_template VARCHAR(200) NOT NULL,
    base_target INTEGER NOT NULL,
    base_reward INTEGER NOT NULL,
    skill_multiplier DECIMAL(3,2) DEFAULT 1.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE player_missions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    mission_type VARCHAR(30) NOT NULL,
    difficulty_level VARCHAR(20) NOT NULL,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(200) NOT NULL,
    target INTEGER NOT NULL,
    reward INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_mission_progress CHECK (
        progress >= 0 AND 
        progress <= target AND
        target > 0 AND
        reward > 0
    )
);

-- Achievements system - Global achievements
CREATE TABLE achievements (
    id VARCHAR(50) PRIMARY KEY,
    category VARCHAR(30) NOT NULL, -- 'score', 'survival', 'collection', 'special'
    rarity VARCHAR(20) NOT NULL, -- 'common', 'rare', 'epic', 'legendary'
    title VARCHAR(100) NOT NULL,
    description VARCHAR(200) NOT NULL,
    icon_url VARCHAR(255),
    target INTEGER NOT NULL,
    reward_coins INTEGER DEFAULT 0,
    reward_gems INTEGER DEFAULT 0,
    is_secret BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_achievement_data CHECK (
        target > 0 AND
        reward_coins >= 0 AND
        reward_gems >= 0
    )
);

CREATE TABLE player_achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    achievement_id VARCHAR(50) NOT NULL REFERENCES achievements(id),
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(player_id, achievement_id),
    CONSTRAINT valid_achievement_progress CHECK (progress >= 0)
);

-- Purchases and monetization
CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    product_id VARCHAR(100) NOT NULL,
    platform VARCHAR(20) NOT NULL, -- 'ios', 'android', 'web'
    transaction_id VARCHAR(255) NOT NULL,
    receipt_data TEXT,
    amount_usd DECIMAL(10,2),
    currency_code VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'refunded'
    items_granted JSONB, -- What was given to player
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(platform, transaction_id),
    CONSTRAINT valid_purchase_amount CHECK (amount_usd >= 0)
);

-- Analytics and events tracking
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    event_name VARCHAR(100) NOT NULL,
    event_category VARCHAR(50) NOT NULL, -- 'gameplay', 'monetization', 'retention'
    parameters JSONB,
    session_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Partitioning by date for performance
    PARTITION BY RANGE (created_at)
);

-- Create partitions for analytics (current month + next 3 months)
CREATE TABLE analytics_events_current PARTITION OF analytics_events
    FOR VALUES FROM (DATE_TRUNC('month', CURRENT_DATE)) 
    TO (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month'));

-- Leaderboards - Materialized view for performance
CREATE MATERIALIZED VIEW leaderboard_global AS
SELECT 
    ROW_NUMBER() OVER (ORDER BY s.score DESC, s.created_at ASC) as rank,
    p.id as player_id,
    p.nickname,
    s.score,
    s.skin_used,
    s.created_at as achieved_at,
    p.country_code
FROM scores s
JOIN players p ON s.player_id = p.id
WHERE s.created_at >= NOW() - INTERVAL '30 days'
  AND p.is_banned = FALSE
ORDER BY s.score DESC, s.created_at ASC
LIMIT 1000;

CREATE UNIQUE INDEX ON leaderboard_global (rank);
CREATE INDEX ON leaderboard_global (player_id);

-- Weekly leaderboard
CREATE MATERIALIZED VIEW leaderboard_weekly AS
SELECT 
    ROW_NUMBER() OVER (ORDER BY s.score DESC, s.created_at ASC) as rank,
    p.id as player_id,
    p.nickname,
    s.score,
    s.skin_used,
    s.created_at as achieved_at
FROM scores s
JOIN players p ON s.player_id = p.id
WHERE s.created_at >= DATE_TRUNC('week', NOW())
  AND p.is_banned = FALSE
ORDER BY s.score DESC, s.created_at ASC
LIMIT 500;

CREATE UNIQUE INDEX ON leaderboard_weekly (rank);

-- Indexes for performance
CREATE INDEX idx_players_device_id ON players(device_id);
CREATE INDEX idx_players_nickname ON players(nickname);
CREATE INDEX idx_players_last_active ON players(last_active_at);
CREATE INDEX idx_players_best_score ON players(best_score DESC);

CREATE INDEX idx_scores_player_id ON scores(player_id);
CREATE INDEX idx_scores_score_desc ON scores(score DESC);
CREATE INDEX idx_scores_created_at ON scores(created_at DESC);
CREATE INDEX idx_scores_leaderboard ON scores(score DESC, created_at ASC) WHERE created_at >= NOW() - INTERVAL '30 days';

CREATE INDEX idx_inventory_player_id ON player_inventory(player_id);
CREATE INDEX idx_inventory_equipped ON player_inventory(player_id, equipped) WHERE equipped = TRUE;

CREATE INDEX idx_missions_player_active ON player_missions(player_id, expires_at) WHERE completed = FALSE;
CREATE INDEX idx_missions_daily_reset ON player_missions(created_at, mission_type) WHERE mission_type LIKE 'daily_%';

CREATE INDEX idx_achievements_player ON player_achievements(player_id);
CREATE INDEX idx_achievements_completed ON player_achievements(player_id, completed_at) WHERE completed = TRUE;

CREATE INDEX idx_purchases_player ON purchases(player_id);
CREATE INDEX idx_purchases_status ON purchases(status, created_at);

CREATE INDEX idx_analytics_player_event ON analytics_events(player_id, event_name, created_at);
CREATE INDEX idx_analytics_category_time ON analytics_events(event_category, created_at);

-- Functions and triggers

-- Update player's updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_players_updated_at 
    BEFORE UPDATE ON players 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-refresh leaderboards (every 5 minutes)
CREATE OR REPLACE FUNCTION refresh_leaderboards()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;
    REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_weekly;
END;
$$ LANGUAGE plpgsql;

-- Validate score submission (anti-cheat)
CREATE OR REPLACE FUNCTION validate_score_submission(
    p_player_id UUID,
    p_score INTEGER,
    p_game_duration INTEGER,
    p_survival_time INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
    player_best_score INTEGER;
    avg_score_per_second DECIMAL;
    is_suspicious BOOLEAN := FALSE;
BEGIN
    -- Get player's current best score
    SELECT best_score INTO player_best_score 
    FROM players 
    WHERE id = p_player_id;
    
    -- Calculate average score per second
    IF p_survival_time > 0 THEN
        avg_score_per_second := p_score::DECIMAL / p_survival_time;
    ELSE
        avg_score_per_second := 0;
    END IF;
    
    -- Basic validation rules
    IF p_score < 0 OR p_game_duration <= 0 OR p_survival_time < 0 THEN
        RETURN FALSE;
    END IF;
    
    -- Suspicious if score is 10x better than previous best
    IF player_best_score > 0 AND p_score > (player_best_score * 10) THEN
        is_suspicious := TRUE;
    END IF;
    
    -- Suspicious if scoring too fast (more than 5 points per second)
    IF avg_score_per_second > 5.0 THEN
        is_suspicious := TRUE;
    END IF;
    
    -- Log suspicious activity but don't reject (for manual review)
    IF is_suspicious THEN
        INSERT INTO analytics_events (player_id, event_name, event_category, parameters)
        VALUES (
            p_player_id,
            'suspicious_score',
            'anti_cheat',
            jsonb_build_object(
                'score', p_score,
                'previous_best', player_best_score,
                'score_per_second', avg_score_per_second,
                'game_duration', p_game_duration
            )
        );
    END IF;
    
    RETURN TRUE; -- Allow score but flag for review
END;
$$ LANGUAGE plpgsql;

-- Initial data seeding

-- Insert default achievements
INSERT INTO achievements (id, category, rarity, title, description, target, reward_coins, reward_gems) VALUES
('first_flight', 'score', 'common', 'First Flight', 'Score your first point', 1, 50, 0),
('sky_rookie', 'score', 'common', 'Sky Rookie', 'Reach 10 points', 10, 100, 5),
('cloud_surfer', 'score', 'rare', 'Cloud Surfer', 'Reach 25 points', 25, 200, 10),
('storm_chaser', 'score', 'rare', 'Storm Chaser', 'Reach 50 points', 50, 300, 15),
('sky_master', 'score', 'epic', 'Sky Master', 'Reach 100 points', 100, 500, 25),
('legend_pilot', 'score', 'legendary', 'Legend Pilot', 'Reach 200 points', 200, 1000, 50),

('marathon_flyer', 'survival', 'rare', 'Marathon Flyer', 'Survive 60 seconds', 60, 250, 10),
('endurance_ace', 'survival', 'epic', 'Endurance Ace', 'Survive 120 seconds', 120, 400, 20),

('dedicated_pilot', 'collection', 'common', 'Dedicated Pilot', 'Play 10 games', 10, 150, 5),
('frequent_flyer', 'collection', 'rare', 'Frequent Flyer', 'Play 50 games', 50, 400, 15),
('sky_veteran', 'collection', 'epic', 'Sky Veteran', 'Play 100 games', 100, 750, 30),

('coin_collector', 'collection', 'common', 'Coin Collector', 'Earn 1000 coins total', 1000, 200, 10),
('treasure_hunter', 'collection', 'rare', 'Treasure Hunter', 'Earn 5000 coins total', 5000, 500, 25),

('streak_starter', 'special', 'rare', 'Streak Starter', 'Get 3 consecutive games above 10 points', 3, 300, 15),
('consistency_king', 'special', 'epic', 'Consistency King', 'Get 5 consecutive games above 20 points', 5, 600, 30);

-- Insert mission templates
INSERT INTO missions_templates (mission_type, difficulty_level, title_template, description_template, base_target, base_reward, skill_multiplier) VALUES
('play_games', 'easy', 'Take Flight', 'Play {target} games today', 3, 75, 1.0),
('play_games', 'medium', 'Sky Explorer', 'Play {target} games today', 5, 150, 1.2),
('play_games', 'hard', 'Dedicated Pilot', 'Play {target} games today', 8, 300, 1.5),

('reach_score', 'easy', 'Sky Achievement', 'Reach {target} points in a single game', 5, 75, 0.6),
('reach_score', 'medium', 'Cloud Breaker', 'Reach {target} points in a single game', 15, 150, 0.7),
('reach_score', 'hard', 'Storm Rider', 'Reach {target} points in a single game', 30, 300, 0.8),

('maintain_streak', 'medium', 'Consistency Master', 'Score above {threshold} in {target} consecutive games', 3, 200, 1.0),
('maintain_streak', 'hard', 'Streak Legend', 'Score above {threshold} in {target} consecutive games', 5, 400, 1.2),

('use_continue', 'medium', 'Never Give Up', 'Use continue {target} times', 2, 150, 1.0),
('use_continue', 'hard', 'Persistent Pilot', 'Use continue {target} times', 4, 300, 1.0),

('collect_coins', 'easy', 'Treasure Hunter', 'Collect {target} coins from any source', 200, 100, 1.0),
('collect_coins', 'medium', 'Coin Master', 'Collect {target} coins from any source', 500, 200, 1.0),

('survive_time', 'medium', 'Endurance Test', 'Survive for {target} seconds in a single game', 30, 200, 1.0),
('survive_time', 'hard', 'Marathon Flyer', 'Survive for {target} seconds in a single game', 60, 400, 1.0),

('change_nickname', 'easy', 'Personal Touch', 'Change your nickname to personalize your profile', 1, 200, 1.0);

COMMIT;
