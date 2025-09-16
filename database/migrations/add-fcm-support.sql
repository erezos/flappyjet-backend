-- 🔥 FCM Support Migration
-- Adds Firebase Cloud Messaging support with timezone awareness

-- FCM Tokens table for storing device tokens
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id SERIAL PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('android', 'ios')),
  timezone VARCHAR(100) DEFAULT 'UTC',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure one token per player
  UNIQUE(player_id)
);

-- Notification history for analytics and preventing duplicates
CREATE TABLE IF NOT EXISTS notification_history (
  id SERIAL PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  sent_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  
  -- No inline indexes needed here
);

-- Add notification preferences and timezone to players table
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
  "hearts": true,
  "streak": true,
  "engagement": true,
  "tournaments": true,
  "achievements": true
}';

ALTER TABLE players 
ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'UTC';

-- Add notification tracking columns to players table
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS last_hearts_notification TIMESTAMP;

ALTER TABLE players 
ADD COLUMN IF NOT EXISTS last_streak_notification TIMESTAMP;

ALTER TABLE players 
ADD COLUMN IF NOT EXISTS last_engagement_notification TIMESTAMP;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_platform ON fcm_tokens(platform);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_updated ON fcm_tokens(updated_at);
CREATE INDEX IF NOT EXISTS idx_notification_history_player_type ON notification_history(player_id, type);
CREATE INDEX IF NOT EXISTS idx_notification_history_sent_at ON notification_history(sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_history_type_sent ON notification_history(type, sent_at);

-- Create indexes for efficient notification queries
CREATE INDEX IF NOT EXISTS idx_players_timezone ON players(timezone);
CREATE INDEX IF NOT EXISTS idx_players_hearts_refill ON players(hearts, last_heart_refill) WHERE hearts < 3;
CREATE INDEX IF NOT EXISTS idx_players_last_game ON players(last_game_played);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for fcm_tokens table
DROP TRIGGER IF EXISTS update_fcm_tokens_updated_at ON fcm_tokens;
CREATE TRIGGER update_fcm_tokens_updated_at
    BEFORE UPDATE ON fcm_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default notification preferences for existing players
UPDATE players 
SET notification_preferences = '{
  "hearts": true,
  "streak": true,
  "engagement": true,
  "tournaments": true,
  "achievements": true
}'
WHERE notification_preferences IS NULL;

-- Create view for active FCM tokens (tokens updated within last 30 days)
CREATE OR REPLACE VIEW active_fcm_tokens AS
SELECT 
  ft.*,
  p.player_name,
  p.timezone,
  p.notification_preferences,
  p.hearts,
  p.last_heart_refill,
  p.last_game_played
FROM fcm_tokens ft
JOIN players p ON ft.player_id = p.id
WHERE ft.updated_at > NOW() - INTERVAL '30 days'
AND ft.platform = 'android'; -- Only Android for FCM

-- Create view for notification analytics
CREATE OR REPLACE VIEW notification_analytics AS
SELECT 
  DATE(sent_at) as date,
  type,
  COUNT(*) as total_sent,
  COUNT(DISTINCT player_id) as unique_players
FROM notification_history
WHERE sent_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(sent_at), type
ORDER BY date DESC, type;

-- Grant permissions (adjust based on your user setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON fcm_tokens TO your_app_user;
-- GRANT SELECT, INSERT ON notification_history TO your_app_user;
-- GRANT SELECT ON active_fcm_tokens TO your_app_user;
-- GRANT SELECT ON notification_analytics TO your_app_user;

-- Add comments for documentation
COMMENT ON TABLE fcm_tokens IS 'Stores Firebase Cloud Messaging tokens for push notifications';
COMMENT ON TABLE notification_history IS 'Tracks sent notifications for analytics and duplicate prevention';
COMMENT ON COLUMN players.notification_preferences IS 'JSON object storing user notification preferences';
COMMENT ON COLUMN players.timezone IS 'User timezone for smart notification scheduling';
COMMENT ON VIEW active_fcm_tokens IS 'Active FCM tokens with player data for notification processing';
COMMENT ON VIEW notification_analytics IS 'Notification sending statistics for the last 30 days';
