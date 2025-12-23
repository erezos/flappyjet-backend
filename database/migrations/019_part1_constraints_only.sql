-- ============================================================================
-- MIGRATION 019 - PART 1: CONSTRAINTS ONLY
-- Run this first, then part 2 for indexes
-- ============================================================================

-- Drop existing constraints if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_event_type' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_event_type;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_user_id' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_payload' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_payload;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_attempts' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_attempts;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_campaign_id' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events DROP CONSTRAINT valid_campaign_id;
  END IF;
END $$;

-- Add constraints
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    'app_installed', 'app_launched', 'user_registered', 'settings_changed', 'app_uninstalled',
    'user_installed', 'user_acquired',
    'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used', 'level_started', 'level_completed', 'level_failed',
    'currency_earned', 'currency_spent', 'purchase_initiated', 'purchase_completed',
    'skin_unlocked', 'skin_equipped', 'achievement_unlocked', 'mission_completed', 'daily_streak_claimed', 'level_unlocked',
    'leaderboard_viewed', 'tournament_entered', 'ad_watched', 'share_clicked', 'notification_received',
    'bonus_collected',
    'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
    'app_crashed', 'app_error'
  )
);

ALTER TABLE events ADD CONSTRAINT valid_user_id CHECK (LENGTH(user_id) > 0);
ALTER TABLE events ADD CONSTRAINT valid_payload CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE events ADD CONSTRAINT valid_attempts CHECK (processing_attempts >= 0);
ALTER TABLE events ADD CONSTRAINT valid_campaign_id CHECK (campaign_id IS NULL OR LENGTH(campaign_id) > 0);

SELECT 'Part 1 completed: Constraints added' AS status;

