-- ============================================================================
-- Migration 015: Add Rate Us Event Types (November 2025)
-- ============================================================================
-- Purpose: Add rate_us event types for tracking rating funnel in dashboard
-- Events:
--   - rate_us_initialized: Manager initialized
--   - rate_us_trigger: Popup trigger point reached
--   - rate_us_popup_shown: Popup displayed to user
--   - rate_us_prompt_shown: Native prompt shown
--   - rate_us_rate_tapped: User tapped "Rate" button
--   - rate_us_maybe_later: User tapped "Maybe Later"
--   - rate_us_declined: User tapped "No Thanks" (won't show again)
--   - rate_us_completed: User completed rating (assumed from native prompt)
--   - rate_us_store_opened: Store listing opened
-- Date: 2025-11-29
-- ============================================================================

-- Drop existing constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

-- Add updated constraint with ALL event types including rate_us
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
    
    -- ⭐ NEW: Rate Us Events
    'rate_us_initialized',      -- Manager initialized with session count
    'rate_us_trigger',          -- Trigger point reached (achievement, streak, etc.)
    'rate_us_popup_shown',      -- Popup displayed to user
    'rate_us_prompt_shown',     -- Native system prompt shown
    'rate_us_rate_tapped',      -- User tapped "Rate" button
    'rate_us_maybe_later',      -- User tapped "Maybe Later"
    'rate_us_declined',         -- User tapped "No Thanks"
    'rate_us_completed',        -- User completed rating
    'rate_us_store_opened'      -- Store listing opened
  )
);

-- Create indexes for rate_us events (for dashboard queries)
CREATE INDEX IF NOT EXISTS idx_events_rate_us 
  ON events(event_type, received_at) 
  WHERE event_type LIKE 'rate_us_%';

-- Verify constraint was created
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'valid_event_type';

-- Log success
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 015_add_rate_us_events.sql completed successfully';
  RAISE NOTICE '   Added: rate_us_initialized, rate_us_trigger, rate_us_popup_shown';
  RAISE NOTICE '   Added: rate_us_prompt_shown, rate_us_rate_tapped, rate_us_maybe_later';
  RAISE NOTICE '   Added: rate_us_declined, rate_us_completed, rate_us_store_opened';
END $$;

