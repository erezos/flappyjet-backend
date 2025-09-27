-- Migration: Add Anonymous User Support
-- This migration adds support for anonymous users in the players table
-- Date: 2024-01-15
-- Purpose: Enable tracking of unauthenticated users to capture complete user base

-- Add is_anonymous column to players table
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN players.is_anonymous IS 'Indicates if this player is anonymous (no authentication) or authenticated';

-- Create index for efficient anonymous user queries
CREATE INDEX IF NOT EXISTS idx_players_anonymous 
ON players (is_anonymous);

-- Create index for anonymous user analytics
CREATE INDEX IF NOT EXISTS idx_players_anonymous_created 
ON players (is_anonymous, created_at) 
WHERE is_anonymous = true;

-- Create index for authenticated vs anonymous comparison
CREATE INDEX IF NOT EXISTS idx_players_auth_status_score 
ON players (is_anonymous, best_score DESC);

-- Update existing players to be marked as authenticated (they must have auth tokens to be in DB)
UPDATE players 
SET is_anonymous = false 
WHERE is_anonymous IS NULL;

-- Create view for anonymous user analytics
CREATE OR REPLACE VIEW anonymous_user_stats AS
SELECT 
    COUNT(*) as total_anonymous_users,
    COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as daily_anonymous_users,
    COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as weekly_anonymous_users,
    AVG(best_score) as avg_anonymous_score,
    MAX(best_score) as max_anonymous_score,
    AVG(total_games) as avg_anonymous_games,
    COUNT(DISTINCT country_code) as anonymous_countries,
    COUNT(DISTINCT platform) as anonymous_platforms
FROM players 
WHERE is_anonymous = true;

-- Create view for authentication conversion analytics
CREATE OR REPLACE VIEW auth_conversion_stats AS
SELECT 
    COUNT(CASE WHEN is_anonymous = true THEN 1 END) as anonymous_users,
    COUNT(CASE WHEN is_anonymous = false THEN 1 END) as authenticated_users,
    ROUND(
        COUNT(CASE WHEN is_anonymous = false THEN 1 END)::numeric / 
        NULLIF(COUNT(*)::numeric, 0) * 100, 2
    ) as authentication_rate_percent,
    COUNT(*) as total_users
FROM players;

-- Grant permissions for analytics views
GRANT SELECT ON anonymous_user_stats TO PUBLIC;
GRANT SELECT ON auth_conversion_stats TO PUBLIC;

-- Add constraint to ensure device_id is unique for anonymous users
-- (Anonymous users are identified by device_id, authenticated users by player_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_anonymous_device_unique 
ON players (device_id) 
WHERE is_anonymous = true;

-- Log migration completion
INSERT INTO schema_migrations (version, description, applied_at) 
VALUES (
    '20240115_add_anonymous_support', 
    'Add anonymous user support with is_anonymous column and analytics views',
    NOW()
) ON CONFLICT (version) DO NOTHING;
