-- ============================================================================
-- DIAGNOSTIC: Find specific rows violating the constraint
-- Run this to see exactly which rows are causing the issue
-- ============================================================================

-- Find rows in the problematic partition that would violate the new constraint
SELECT 
  id,
  event_type,
  user_id,
  received_at,
  payload->>'timestamp' as event_timestamp
FROM events_week_2025_12_22
WHERE event_type NOT IN (
  -- User Lifecycle
  'app_installed', 'app_launched', 'user_registered', 'user_installed', 'user_acquired',
  'nickname_changed', 'settings_changed', 'app_uninstalled',
  'first_open', 'session_started', 'session_ended',
  
  -- Rate Us Events
  'rate_us_initialized', 'rate_us_popup_shown', 'rate_us_rate_tapped',
  'rate_us_prompt_shown', 'rate_us_store_opened', 'rate_us_maybe_later',
  'rate_us_declined', 'rate_us_completed',
  
  -- Game Session
  'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used',
  'level_started', 'level_completed', 'level_failed', 'level_unlocked',
  'bonus_collected', 'powerup_activated',
  
  -- Economy & Purchases
  'currency_earned', 'currency_spent', 'purchase_initiated', 'purchase_completed',
  'skin_purchased', 'no_ads_purchased', 'currency_bundle_purchased', 'bundle_purchased',
  'special_offer_purchased',
  
  -- Progression
  'skin_unlocked', 'skin_equipped', 'achievement_unlocked', 'achievement_claimed',
  'mission_unlocked', 'mission_completed',
  'item_unlocked', 'item_equipped',
  'prize_available', 'prize_claimed',
  
  -- Daily Streak
  'daily_streak_claimed', 'daily_streak_milestone', 'daily_streak_broken',
  'daily_streak_cycle_completed',
  
  -- Tournament Events
  'tournament_entered', 'tournament_round_started', 'tournament_round_completed',
  'tournament_round_advanced', 'tournament_round_failed', 'tournament_try_failed',
  'tournament_level_started', 'tournament_level_completed', 
  'tournament_start_over', 'tournament_game_over_dismissed',
  'tournament_completed', 'tournament_abandoned',
  'playoff_battle_started', 'playoff_battle_won', 'playoff_battle_lost',
  'tournament_manager_initialized',
  
  -- Ads & Monetization
  'ad_watched', 'ad_revenue', 'ad_failed_to_load', 'ad_skipped',
  'interstitial_shown', 'interstitial_dismissed', 'interstitial_clicked',
  'loss_streak_ad_shown', 'tournament_interstitial_shown',
  
  -- Social & Engagement
  'leaderboard_viewed', 'share_clicked', 'notification_received',
  
  -- Tutorial/FTUE
  'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
  
  -- Performance & Errors
  'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
  'app_crashed', 'app_error'
)
AND event_type NOT LIKE 'conversion_%'
LIMIT 20;

