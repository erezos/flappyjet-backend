-- ============================================================================
-- Migration 009: Add Monetization Event Types
-- ============================================================================
-- Purpose: Add skin_purchased, item_unlocked, item_equipped to valid event types
-- Date: 2025-11-19
-- ============================================================================

-- Drop existing constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

-- Add updated constraint with new event types
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    -- User Lifecycle
    'app_installed',
    'app_launched',
    'user_registered',
    'settings_changed',
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
    'skin_purchased',      -- ✅ NEW: Jet/skin purchases
    'item_unlocked',       -- ✅ NEW: Item unlocks
    'item_equipped',       -- ✅ NEW: Item equipped
    'purchase_initiated',
    'purchase_completed',
    
    -- Progression
    'skin_unlocked',
    'skin_equipped',
    'achievement_unlocked',
    'mission_completed',
    'daily_streak_claimed',
    'level_unlocked',
    
    -- Social & Engagement
    'leaderboard_viewed',
    'tournament_entered',
    'ad_watched',
    'share_clicked',
    'notification_received'
  )
);

-- Create index for new event types (performance optimization)
CREATE INDEX IF NOT EXISTS idx_events_skin_purchased 
  ON events(event_type, received_at) 
  WHERE event_type = 'skin_purchased';

CREATE INDEX IF NOT EXISTS idx_events_item_unlocked 
  ON events(event_type, received_at) 
  WHERE event_type = 'item_unlocked';

CREATE INDEX IF NOT EXISTS idx_events_item_equipped 
  ON events(event_type, received_at) 
  WHERE event_type = 'item_equipped';

-- Verify constraint was created
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'valid_event_type';

