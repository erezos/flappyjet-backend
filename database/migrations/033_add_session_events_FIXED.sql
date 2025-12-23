-- ============================================================================
-- MIGRATION: 033_add_session_events_FIXED.sql
-- Purpose: Add session tracking events (first_open, session_started, session_ended) to valid_event_type constraint
-- Date: 2025-12-23
-- Author: FlappyJet Analytics Team
-- 
-- FIX: Handles partitioned tables by checking for invalid event types first
-- ============================================================================

-- Step 1: Find any event types that would violate the new constraint
DO $$
DECLARE
  invalid_types TEXT[];
  invalid_count INTEGER;
BEGIN
  -- Find event types that are NOT in our allowed list and NOT conversion_* patterns
  SELECT ARRAY_AGG(DISTINCT event_type), COUNT(DISTINCT event_type)
  INTO invalid_types, invalid_count
  FROM events
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
    'bonus_collected',
    
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
    'interstitial_shown',
    
    -- Social & Engagement
    'leaderboard_viewed', 'share_clicked', 'notification_received',
    
    -- Tutorial/FTUE
    'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
    
    -- Performance & Errors
    'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
    'app_crashed', 'app_error'
  )
  AND event_type NOT LIKE 'conversion_%';
  
  IF invalid_count > 0 THEN
    RAISE NOTICE '⚠️ Found % invalid event types: %', invalid_count, invalid_types;
    RAISE NOTICE '⚠️ These will need to be added to the constraint or cleaned up';
    -- For now, we'll continue - you may need to add these to the constraint
  ELSE
    RAISE NOTICE '✅ No invalid event types found - safe to proceed';
  END IF;
END $$;

-- Step 2: Drop the existing constraint (if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_event_type' 
    AND conrelid = 'events'::regclass
  ) THEN
    ALTER TABLE events DROP CONSTRAINT valid_event_type;
    RAISE NOTICE '✅ Dropped existing valid_event_type constraint';
  END IF;
END $$;

-- Step 3: Add constraint with NOVALIDATE equivalent (PostgreSQL doesn't support NOVALIDATE for CHECK)
-- We'll use a function-based approach that allows existing invalid data temporarily
-- Actually, PostgreSQL requires all data to be valid. Let's add the constraint and handle errors.

-- Recreate constraint with new session events
DO $$
BEGIN
  BEGIN
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
        
        -- Game Session (9 events)
        'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used',
        'level_started', 'level_completed', 'level_failed', 'level_unlocked',
        'bonus_collected',
        
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
        
        -- Ads & Monetization (5 events)
        'ad_watched', 'ad_revenue', 'ad_failed_to_load', 'ad_skipped',
        'interstitial_shown',
        
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
    RAISE NOTICE '✅ Successfully added valid_event_type constraint';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ Failed to add constraint: %', SQLERRM;
    RAISE NOTICE '💡 Run this query to find invalid event types:';
    RAISE NOTICE '   SELECT DISTINCT event_type FROM events WHERE event_type NOT IN (...) AND event_type NOT LIKE ''conversion_%%'';';
    RAISE;
  END;
END $$;

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
  
  RAISE NOTICE '✅ Migration 033_add_session_events.sql completed successfully';
  RAISE NOTICE '📊 Added session events: first_open, session_started, session_ended';
  RAISE NOTICE '📊 Added tutorial events: tutorial_started, tutorial_completed, tutorial_skipped';
END $$;

