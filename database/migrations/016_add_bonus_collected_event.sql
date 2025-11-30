-- ============================================================================
-- Migration 016: Add Bonus Collected Event Type (November 2025)
-- ============================================================================
-- Purpose: Add bonus_collected event for tracking in-game bonus collection
-- Events:
--   - bonus_collected: Shield/coin/gem bonus collected during gameplay
-- Analytics Value:
--   - Track which bonuses are collected per level
--   - Measure shield effectiveness (do shields help completion?)
--   - Monitor economy inflation from bonus coins/gems
--   - Optimize bonus spawn configurations
-- Date: 2025-11-30
-- ============================================================================

-- Drop existing constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

-- Add updated constraint with bonus_collected
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    -- User Lifecycle
    'app_installed',
    'app_launched',
    'user_registered',
    'settings_changed',
    'nickname_changed',
    'app_uninstalled',
    'user_installed',
    
    -- Game Session
    'game_started',
    'game_ended',
    'game_paused',
    'game_resumed',
    'continue_used',
    'level_started',
    'level_completed',
    'level_failed',
    
    -- Economy
    'currency_earned',
    'bonus_collected',      -- 🎁 NEW: In-game bonus collected
    'currency_spent',
    'skin_purchased',
    'item_unlocked',
    'item_equipped',
    'purchase_initiated',
    'purchase_completed',
    
    -- Progression
    'skin_unlocked',
    'skin_equipped',
    'achievement_unlocked',
    'achievement_claimed',
    'mission_completed',
    'mission_unlocked',
    'daily_streak_claimed',
    'daily_streak_milestone',
    'daily_streak_broken',
    'daily_streak_cycle_completed',
    'level_unlocked',
    
    -- Prizes
    'prize_available',
    'prize_claimed',
    
    -- Ads & Monetization
    'ad_watched',
    'ad_revenue',
    'interstitial_shown',
    'interstitial_dismissed',
    'interstitial_clicked',
    
    -- Social & Engagement
    'leaderboard_viewed',
    'tournament_entered',
    'share_clicked',
    'notification_received',
    
    -- Rate Us Events
    'rate_us_initialized',
    'rate_us_trigger',
    'rate_us_popup_shown',
    'rate_us_prompt_shown',
    'rate_us_rate_tapped',
    'rate_us_maybe_later',
    'rate_us_declined',
    'rate_us_completed',
    'rate_us_store_opened'
  )
);

-- Create index for bonus_collected events (faster queries)
CREATE INDEX IF NOT EXISTS idx_events_bonus_collected 
ON events(event_type, received_at) 
WHERE event_type = 'bonus_collected';

-- Create index for bonus analytics queries (by level)
CREATE INDEX IF NOT EXISTS idx_events_bonus_collected_level 
ON events((payload->>'level_id'), (payload->>'bonus_type')) 
WHERE event_type = 'bonus_collected';

-- Verify constraint was created
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'valid_event_type';

-- Log success
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 016_add_bonus_collected_event.sql completed successfully';
  RAISE NOTICE '   Added: bonus_collected event type';
  RAISE NOTICE '   Created: idx_events_bonus_collected, idx_events_bonus_collected_level';
END $$;

