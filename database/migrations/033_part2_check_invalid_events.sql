-- ============================================================================
-- MIGRATION 033 - PART 2: Check for invalid event types
-- Purpose: Find any event types that would violate the new constraint
-- Date: 2025-12-23
-- 
-- Run this BEFORE part 3 to ensure all event types are valid
-- ============================================================================

-- Find all event types that would violate the new constraint
SELECT 
  event_type,
  COUNT(*) as event_count,
  MIN(received_at) as first_seen,
  MAX(received_at) as last_seen,
  COUNT(DISTINCT user_id) as unique_users
FROM events
WHERE event_type NOT IN (
  -- User Lifecycle (11 events)
  'app_installed', 'app_launched', 'user_registered', 'user_installed', 'user_acquired',
  'nickname_changed', 'settings_changed', 'app_uninstalled',
  'first_open', 'session_started', 'session_ended',
  
  -- Rate Us Events (8 events)
  'rate_us_initialized', 'rate_us_popup_shown', 'rate_us_rate_tapped',
  'rate_us_prompt_shown', 'rate_us_store_opened', 'rate_us_maybe_later',
  'rate_us_declined', 'rate_us_completed',
  
  -- Game Session (10 events)
  'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used',
  'level_started', 'level_completed', 'level_failed', 'level_unlocked',
  'bonus_collected', 'powerup_activated',
  
  -- Economy & Purchases (9 events)
  'currency_earned', 'currency_spent', 'purchase_initiated', 'purchase_completed',
  'skin_purchased', 'no_ads_purchased', 'currency_bundle_purchased', 'bundle_purchased',
  'special_offer_purchased',
  
  -- Progression (10 events)
  'skin_unlocked', 'skin_equipped', 'achievement_unlocked', 'achievement_claimed',
  'mission_unlocked', 'mission_completed',
  'item_unlocked', 'item_equipped',
  'prize_available', 'prize_claimed',
  
  -- Daily Streak (4 events)
  'daily_streak_claimed', 'daily_streak_milestone', 'daily_streak_broken',
  'daily_streak_cycle_completed',
  
  -- Tournament Events (16 events)
  'tournament_entered', 'tournament_round_started', 'tournament_round_completed',
  'tournament_round_advanced', 'tournament_round_failed', 'tournament_try_failed',
  'tournament_level_started', 'tournament_level_completed', 
  'tournament_start_over', 'tournament_game_over_dismissed',
  'tournament_completed', 'tournament_abandoned',
  'playoff_battle_started', 'playoff_battle_won', 'playoff_battle_lost',
  'tournament_manager_initialized',
  
  -- Ads & Monetization (10 events)
  'ad_watched', 'ad_revenue', 'ad_failed_to_load', 'ad_skipped',
  'interstitial_shown', 'interstitial_dismissed', 'interstitial_clicked',
  'loss_streak_ad_shown', 'tournament_interstitial_shown',
  
  -- Social & Engagement (3 events)
  'leaderboard_viewed', 'share_clicked', 'notification_received',
  
  -- Tutorial/FTUE (3 events)
  'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
  
  -- Performance & Errors (6 events)
  'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
  'app_crashed', 'app_error'
)
AND event_type NOT LIKE 'conversion_%'
GROUP BY event_type
ORDER BY event_count DESC;

-- Summary message
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT event_type) INTO invalid_count
  FROM events
  WHERE event_type NOT IN (
    'app_installed', 'app_launched', 'user_registered', 'user_installed', 'user_acquired',
    'nickname_changed', 'settings_changed', 'app_uninstalled',
    'first_open', 'session_started', 'session_ended',
    'rate_us_initialized', 'rate_us_popup_shown', 'rate_us_rate_tapped',
    'rate_us_prompt_shown', 'rate_us_store_opened', 'rate_us_maybe_later',
    'rate_us_declined', 'rate_us_completed',
    'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used',
    'level_started', 'level_completed', 'level_failed', 'level_unlocked',
    'bonus_collected', 'powerup_activated',
    'currency_earned', 'currency_spent', 'purchase_initiated', 'purchase_completed',
    'skin_purchased', 'no_ads_purchased', 'currency_bundle_purchased', 'bundle_purchased',
    'special_offer_purchased',
    'skin_unlocked', 'skin_equipped', 'achievement_unlocked', 'achievement_claimed',
    'mission_unlocked', 'mission_completed',
    'item_unlocked', 'item_equipped',
    'prize_available', 'prize_claimed',
    'daily_streak_claimed', 'daily_streak_milestone', 'daily_streak_broken',
    'daily_streak_cycle_completed',
    'tournament_entered', 'tournament_round_started', 'tournament_round_completed',
    'tournament_round_advanced', 'tournament_round_failed', 'tournament_try_failed',
    'tournament_level_started', 'tournament_level_completed', 
    'tournament_start_over', 'tournament_game_over_dismissed',
    'tournament_completed', 'tournament_abandoned',
    'playoff_battle_started', 'playoff_battle_won', 'playoff_battle_lost',
    'tournament_manager_initialized',
    'ad_watched', 'ad_revenue', 'ad_failed_to_load', 'ad_skipped',
    'interstitial_shown', 'interstitial_dismissed', 'interstitial_clicked',
    'loss_streak_ad_shown', 'tournament_interstitial_shown',
    'leaderboard_viewed', 'share_clicked', 'notification_received',
    'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
    'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
    'app_crashed', 'app_error'
  )
  AND event_type NOT LIKE 'conversion_%';
  
  IF invalid_count = 0 THEN
    RAISE NOTICE '✅ All event types are valid! You can proceed to part 3.';
  ELSE
    RAISE WARNING '⚠️  Found % invalid event type(s). Please add them to the constraint in part 3 before running it.', invalid_count;
  END IF;
END $$;

