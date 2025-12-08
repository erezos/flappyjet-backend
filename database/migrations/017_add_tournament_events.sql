-- ============================================================================
-- Migration 017: Add Tournament Events (December 2025 - v2.3.0)
-- ============================================================================
-- Purpose: Add tournament/playoff event types for the new tournament system
-- Events:
--   - tournament_manager_initialized: Tournament system initialized
--   - tournament_round_started: Round/battle started
--   - playoff_battle_started: Playoff battle initiated
--   - playoff_battle_won: User won a playoff battle
--   - playoff_battle_lost: User lost a playoff battle
--   - tournament_start_over: User restarted tournament
--   - tournament_game_over_dismissed: User dismissed game over popup
--   - tournament_interstitial_shown: Interstitial ad shown in tournament
--   - tournament_interstitial_cooldown: Ad skipped due to cooldown
--   - powerup_activated: Powerup used in game
--   - powerup_expired: Powerup duration ended
--   - loss_streak_ad_shown: Loss streak triggered ad
--   - loss_streak_ad_pending: Loss streak ad queued
-- Analytics Value:
--   - Track tournament engagement and completion rates
--   - Measure round-by-round conversion
--   - Monitor ad revenue from tournament context
--   - Analyze tournament difficulty balance
-- Date: 2025-12-08
-- ============================================================================

-- Drop existing constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

-- Add updated constraint with all tournament events
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
    'bonus_collected',
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
    'loss_streak_ad_shown',       -- 📊 NEW: Loss streak ad triggered
    'loss_streak_ad_pending',     -- 📊 NEW: Loss streak ad queued
    
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
    'rate_us_store_opened',
    
    -- 🏆 Tournament Events (v2.3.0)
    'tournament_manager_initialized',
    'tournament_round_started',
    'playoff_battle_started',
    'playoff_battle_won',
    'playoff_battle_lost',
    'tournament_round_completed',         -- ✅ NEW: Round completed
    'tournament_round_advanced',          -- ✅ NEW: Advanced to next round
    'tournament_completed',               -- ✅ NEW: Tournament won
    'tournament_ticket_used',             -- ✅ NEW: Free ticket used
    'tournament_start_over',
    'tournament_game_over_dismissed',
    'tournament_interstitial_shown',
    'tournament_interstitial_cooldown',
    
    -- ⚡ Powerup Events
    'powerup_activated',
    'powerup_expired',
    
    -- 🎯 Conversion Milestone Events
    'conversion_games_played_3',
    'conversion_games_played_5',
    'conversion_games_played_10',
    'conversion_sessions_count_3',
    'conversion_sessions_count_6',
    'conversion_level_completed_3',
    'conversion_level_completed_5',
    'conversion_level_completed_10'
  )
);

-- Create indexes for tournament event queries (faster analytics)
CREATE INDEX IF NOT EXISTS idx_events_tournament_manager_init 
ON events(event_type, received_at) 
WHERE event_type = 'tournament_manager_initialized';

CREATE INDEX IF NOT EXISTS idx_events_playoff_battle 
ON events(event_type, received_at) 
WHERE event_type IN ('playoff_battle_started', 'playoff_battle_won', 'playoff_battle_lost');

CREATE INDEX IF NOT EXISTS idx_events_tournament_completion 
ON events(event_type, received_at) 
WHERE event_type IN ('tournament_round_completed', 'tournament_completed');

CREATE INDEX IF NOT EXISTS idx_events_tournament_actions 
ON events(event_type, received_at) 
WHERE event_type IN ('tournament_start_over', 'tournament_game_over_dismissed');

CREATE INDEX IF NOT EXISTS idx_events_tournament_ads 
ON events(event_type, received_at) 
WHERE event_type IN ('tournament_interstitial_shown', 'tournament_interstitial_cooldown');

-- Create composite index for tournament analytics by tournament_id
CREATE INDEX IF NOT EXISTS idx_events_tournament_id 
ON events((payload->>'tournament_id'), event_type, received_at) 
WHERE event_type LIKE 'tournament_%' OR event_type LIKE 'playoff_%';

-- ============================================================================
-- VERIFICATION QUERY (run after migration to verify)
-- ============================================================================
-- SELECT DISTINCT event_type 
-- FROM events 
-- WHERE event_type LIKE 'tournament_%' OR event_type LIKE 'playoff_%'
-- ORDER BY event_type;
-- ============================================================================

