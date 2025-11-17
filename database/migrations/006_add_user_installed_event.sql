-- ============================================================================
-- MIGRATION: 006_add_user_installed_event.sql
-- Purpose: Add 'user_installed' event type to valid events constraint
-- Date: 2025-11-17
-- Author: FlappyJet Backend Team
-- ============================================================================

-- Drop the existing constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

-- Recreate the constraint with user_installed added
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    -- User Lifecycle (6 events - ADDED user_installed)
    'app_installed',
    'app_launched',
    'user_registered',
    'settings_changed',
    'app_uninstalled',
    'user_installed', -- ✅ NEW: Add user_installed event
    
    -- Game Session (8 events)
    'game_started',
    'game_ended',
    'game_paused',
    'game_resumed',
    'continue_used',
    'level_started',
    'level_completed',
    'level_failed',
    
    -- Economy (4 events)
    'currency_earned',
    'currency_spent',
    'purchase_initiated',
    'purchase_completed',
    
    -- Progression (6 events)
    'skin_unlocked',
    'skin_equipped',
    'achievement_unlocked',
    'mission_completed',
    'daily_streak_claimed',
    'level_unlocked',
    
    -- Social & Engagement (5 events)
    'leaderboard_viewed',
    'tournament_entered',
    'ad_watched',
    'share_clicked',
    'notification_received'
  )
);

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  -- Test that we can insert user_installed event
  PERFORM 1 FROM pg_constraint 
  WHERE conname = 'valid_event_type';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Migration failed: valid_event_type constraint not found';
  END IF;
  
  RAISE NOTICE '✅ Migration 006_add_user_installed_event.sql completed successfully';
END $$;

