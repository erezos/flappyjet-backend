-- ============================================================================
-- MIGRATION 033 - PART 3: Add constraint with new session events
-- Purpose: Add session tracking events to valid_event_type constraint
-- Date: 2025-12-23
-- 
-- ⚠️  IMPORTANT: Run part 2 first to ensure all event types are valid!
-- ============================================================================

-- Add constraint to parent table
-- PostgreSQL will automatically propagate to all partitions
-- This validates ALL existing data in ALL partitions
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    -- User Lifecycle (11 events) ✅ UPDATED: Added first_open, session_started, session_ended
    'app_installed', 'app_launched', 'user_registered', 'user_installed', 'user_acquired',
    'nickname_changed', 'settings_changed', 'app_uninstalled',
    'first_open', 'session_started', 'session_ended', -- ✅ NEW
    
    -- Rate Us Events (8 events)
    'rate_us_initialized', 'rate_us_popup_shown', 'rate_us_rate_tapped',
    'rate_us_prompt_shown', 'rate_us_store_opened', 'rate_us_maybe_later',
    'rate_us_declined', 'rate_us_completed',
    
    -- Game Session (10 events) ✅ UPDATED: Added powerup_activated
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
    
    -- Ads & Monetization (10 events) ✅ UPDATED: Added missing ad events
    'ad_watched', 'ad_revenue', 'ad_failed_to_load', 'ad_skipped',
    'interstitial_shown', 'interstitial_dismissed', 'interstitial_clicked',
    'loss_streak_ad_shown', 'tournament_interstitial_shown',
    
    -- Social & Engagement (3 events)
    'leaderboard_viewed', 'share_clicked', 'notification_received',
    
    -- Tutorial/FTUE (3 events) ✅ NEW: Added tutorial events
    'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
    
    -- Performance & Errors (6 events)
    'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
    'app_crashed', 'app_error'
  )
  OR event_type LIKE 'conversion_%'
);

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_event_type' 
    AND conrelid = 'events'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration failed: valid_event_type constraint not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 033_part3_add_constraint.sql completed successfully';
  RAISE NOTICE '📊 Added session events: first_open, session_started, session_ended';
  RAISE NOTICE '📊 Added tutorial events: tutorial_started, tutorial_completed, tutorial_skipped';
  RAISE NOTICE '📊 Added missing ad events: interstitial_dismissed, interstitial_clicked, loss_streak_ad_shown, tournament_interstitial_shown';
  RAISE NOTICE '📊 Added missing game event: powerup_activated';
END $$;

