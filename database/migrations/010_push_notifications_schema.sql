-- ============================================================================
-- PUSH NOTIFICATIONS SCHEMA MIGRATION
-- Railway Backend - FlappyJet
-- Created: 2025-11-20
-- ============================================================================

-- ============================================================================
-- 1. FCM TOKENS TABLE
-- Stores user device tokens for push notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  fcm_token TEXT NOT NULL,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('android', 'ios')),
  
  -- User metadata for analytics
  country VARCHAR(2),
  timezone VARCHAR(50),
  device_model VARCHAR(255),
  os_version VARCHAR(50),
  app_version VARCHAR(20),
  
  -- Token status
  is_active BOOLEAN DEFAULT true,
  last_notification_sent_at TIMESTAMP,
  last_notification_clicked_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id, fcm_token)
);

-- Indexes for performance
CREATE INDEX idx_fcm_tokens_user_id ON fcm_tokens(user_id);
CREATE INDEX idx_fcm_tokens_active ON fcm_tokens(is_active) WHERE is_active = true;
CREATE INDEX idx_fcm_tokens_last_used ON fcm_tokens(last_used_at);
CREATE INDEX idx_fcm_tokens_country ON fcm_tokens(country);

-- ============================================================================
-- 2. NOTIFICATION EVENTS TABLE
-- Tracks all notification lifecycle events
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_events (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  
  -- Notification details
  notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('1hour', '24hour', '46hour', 'custom')),
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('scheduled', 'sent', 'clicked', 'dismissed', 'failed')),
  
  -- Content
  title TEXT,
  body TEXT,
  message_variant VARCHAR(20), -- 'friendly_A', 'casual_B', 'professional_C'
  
  -- Delivery method
  sent_via VARCHAR(20) CHECK (sent_via IN ('local', 'fcm', 'both')),
  
  -- Reward info (if applicable)
  reward_type VARCHAR(20) CHECK (reward_type IN ('coins', 'gems', 'none')),
  reward_amount INTEGER,
  reward_claimed BOOLEAN DEFAULT false,
  
  -- User context at time of notification
  last_level_played INTEGER,
  current_streak INTEGER,
  games_played_count INTEGER,
  
  -- Metadata
  country VARCHAR(2),
  timezone VARCHAR(50),
  scheduled_for TIMESTAMP,
  sent_at TIMESTAMP,
  clicked_at TIMESTAMP,
  received_at TIMESTAMP DEFAULT NOW(),
  
  -- Additional data
  payload JSONB,
  
  -- Error tracking
  error_message TEXT,
  fcm_response JSONB
);

-- Indexes for analytics queries
CREATE INDEX idx_notification_events_user_id ON notification_events(user_id);
CREATE INDEX idx_notification_events_type ON notification_events(notification_type, event_type);
CREATE INDEX idx_notification_events_received_at ON notification_events(received_at);
CREATE INDEX idx_notification_events_country ON notification_events(country);
CREATE INDEX idx_notification_events_variant ON notification_events(message_variant);
CREATE INDEX idx_notification_events_reward ON notification_events(reward_type, reward_claimed);

-- Composite index for funnel analysis
CREATE INDEX idx_notification_funnel ON notification_events(notification_type, event_type, received_at);

-- ============================================================================
-- 3. NOTIFICATION PREFERENCES TABLE
-- User preferences for notification settings
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  
  -- Enabled types
  enable_1hour BOOLEAN DEFAULT true,
  enable_24hour BOOLEAN DEFAULT true,
  enable_46hour BOOLEAN DEFAULT true,
  
  -- Quiet hours (local time)
  quiet_hours_start TIME DEFAULT '22:00:00', -- 10 PM
  quiet_hours_end TIME DEFAULT '08:00:00',   -- 8 AM
  
  -- Frequency limits
  max_notifications_per_day INTEGER DEFAULT 3,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notification_prefs_user_id ON notification_preferences(user_id);

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function to get user's FCM token
CREATE OR REPLACE FUNCTION get_active_fcm_token(p_user_id VARCHAR)
RETURNS TEXT AS $$
  SELECT fcm_token
  FROM fcm_tokens
  WHERE user_id = p_user_id
    AND is_active = true
    AND platform = 'android' -- Only Android for now
  ORDER BY last_used_at DESC
  LIMIT 1;
$$ LANGUAGE SQL;

-- Function to check if user is in quiet hours
CREATE OR REPLACE FUNCTION is_in_quiet_hours(p_user_id VARCHAR, p_timezone VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  v_prefs RECORD;
  v_user_time TIME;
BEGIN
  -- Get user preferences
  SELECT * INTO v_prefs
  FROM notification_preferences
  WHERE user_id = p_user_id;
  
  -- If no preferences, use defaults (22:00-08:00)
  IF NOT FOUND THEN
    v_prefs.quiet_hours_start := '22:00:00';
    v_prefs.quiet_hours_end := '08:00:00';
  END IF;
  
  -- Convert current time to user's timezone
  v_user_time := (NOW() AT TIME ZONE p_timezone)::TIME;
  
  -- Check if in quiet hours
  IF v_prefs.quiet_hours_start > v_prefs.quiet_hours_end THEN
    -- Quiet hours span midnight (e.g., 22:00 to 08:00)
    RETURN v_user_time >= v_prefs.quiet_hours_start OR v_user_time < v_prefs.quiet_hours_end;
  ELSE
    -- Quiet hours within same day
    RETURN v_user_time >= v_prefs.quiet_hours_start AND v_user_time < v_prefs.quiet_hours_end;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user hit daily notification limit
CREATE OR REPLACE FUNCTION check_daily_notification_limit(p_user_id VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  v_count INTEGER;
  v_limit INTEGER;
BEGIN
  -- Get user's daily limit
  SELECT COALESCE(max_notifications_per_day, 3) INTO v_limit
  FROM notification_preferences
  WHERE user_id = p_user_id;
  
  -- Count notifications sent today
  SELECT COUNT(*) INTO v_count
  FROM notification_events
  WHERE user_id = p_user_id
    AND event_type = 'sent'
    AND received_at >= CURRENT_DATE;
  
  -- Return true if under limit
  RETURN v_count < v_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. INITIAL DATA
-- Create default preferences for existing users
-- ============================================================================

-- This will be run after migration to set up default preferences
-- for any existing users who don't have preferences yet

-- Note: We'll handle this in the app when user first launches after update

-- ============================================================================
-- 6. MIGRATION VERIFICATION
-- ============================================================================

-- Verify tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fcm_tokens') THEN
    RAISE NOTICE '✅ fcm_tokens table created';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_events') THEN
    RAISE NOTICE '✅ notification_events table created';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences') THEN
    RAISE NOTICE '✅ notification_preferences table created';
  END IF;
  
  RAISE NOTICE '🎉 Push notification schema migration complete!';
END $$;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- 
-- DROP TABLE IF EXISTS notification_events CASCADE;
-- DROP TABLE IF EXISTS fcm_tokens CASCADE;
-- DROP TABLE IF EXISTS notification_preferences CASCADE;
-- DROP FUNCTION IF EXISTS get_active_fcm_token(VARCHAR);
-- DROP FUNCTION IF EXISTS is_in_quiet_hours(VARCHAR, VARCHAR);
-- DROP FUNCTION IF EXISTS check_daily_notification_limit(VARCHAR);
-- 
-- ============================================================================

