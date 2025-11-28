-- ============================================================================
-- Migration 014: Add New Event Types (November 2025)
-- ============================================================================
-- Purpose: Add new event types for analytics improvements
-- - nickname_changed (user profile updates)
-- - achievement_claimed (achievement reward claims)
-- - mission_unlocked (mission criteria met)
-- - ad_revenue (estimated ad revenue tracking)
-- - interstitial_shown, interstitial_dismissed, interstitial_clicked (ad tracking)
-- - daily_streak_milestone, daily_streak_broken, daily_streak_cycle_completed
-- - prize_available, prize_claimed (prize system)
-- Date: 2025-11-28
-- ============================================================================

-- Drop existing constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

-- Add updated constraint with ALL event types
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    -- User Lifecycle
    'app_installed',
    'app_launched',
    'user_registered',
    'settings_changed',
    'nickname_changed',      -- ✅ NEW: Player nickname updates
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
    'achievement_claimed',   -- ✅ NEW: Achievement reward claimed
    'mission_completed',
    'mission_unlocked',      -- ✅ NEW: Mission criteria met
    'daily_streak_claimed',
    'daily_streak_milestone', -- ✅ NEW: Streak milestone reached
    'daily_streak_broken',    -- ✅ NEW: Streak broken
    'daily_streak_cycle_completed', -- ✅ NEW: 7-day cycle completed
    'level_unlocked',
    
    -- Prizes
    'prize_available',       -- ✅ NEW: Prize ready to claim
    'prize_claimed',         -- ✅ NEW: Prize claimed
    
    -- Ads & Monetization
    'ad_watched',
    'ad_revenue',            -- ✅ NEW: Estimated ad revenue
    'interstitial_shown',    -- ✅ NEW: Interstitial ad shown
    'interstitial_dismissed', -- ✅ NEW: Interstitial ad dismissed
    'interstitial_clicked',  -- ✅ NEW: Interstitial ad clicked
    
    -- Social & Engagement
    'leaderboard_viewed',
    'tournament_entered',
    'share_clicked',
    'notification_received'
  )
);

-- Create indexes for new event types (performance optimization)
CREATE INDEX IF NOT EXISTS idx_events_nickname_changed 
  ON events(event_type, received_at) 
  WHERE event_type = 'nickname_changed';

CREATE INDEX IF NOT EXISTS idx_events_ad_revenue 
  ON events(event_type, received_at) 
  WHERE event_type = 'ad_revenue';

CREATE INDEX IF NOT EXISTS idx_events_achievement_claimed 
  ON events(event_type, received_at) 
  WHERE event_type = 'achievement_claimed';

CREATE INDEX IF NOT EXISTS idx_events_mission_unlocked 
  ON events(event_type, received_at) 
  WHERE event_type = 'mission_unlocked';

-- Verify constraint was created
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'valid_event_type';

-- Log success
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 014_add_new_event_types.sql completed successfully';
  RAISE NOTICE '   Added: nickname_changed, achievement_claimed, mission_unlocked';
  RAISE NOTICE '   Added: ad_revenue, interstitial_shown, interstitial_dismissed, interstitial_clicked';
  RAISE NOTICE '   Added: daily_streak_milestone, daily_streak_broken, daily_streak_cycle_completed';
  RAISE NOTICE '   Added: prize_available, prize_claimed';
END $$;

