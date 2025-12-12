-- ============================================================================
-- Migration 018: Extend Tournament Events (Dec 2025 - v2.3.x hotfix)
-- ============================================================================
-- Purpose:
--   Allow new tournament event types recently added in the Flutter app and
--   backend schema validation:
--     - tournament_round_failed
--     - tournament_try_failed
--     - tournament_ticket_granted
--     - tournament_level_started
--     - tournament_level_completed
--
-- Notes:
--   - Only updates the valid_event_type constraint (no data migration).
--   - Keeps the full list from migration 017 and appends the new event types.
-- ============================================================================

-- Drop existing constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

-- Add updated constraint with new tournament events
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
    'loss_streak_ad_shown',
    'loss_streak_ad_pending',
    
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
    
    -- 🏆 Tournament Events (extended)
    'tournament_manager_initialized',
    'tournament_round_started',
    'playoff_battle_started',
    'playoff_battle_won',
    'playoff_battle_lost',
    'tournament_round_completed',
    'tournament_round_advanced',
    'tournament_round_failed',       -- NEW
    'tournament_try_failed',         -- NEW
    'tournament_completed',
    'tournament_ticket_used',
    'tournament_ticket_granted',     -- NEW
    'tournament_start_over',
    'tournament_game_over_dismissed',
    'tournament_interstitial_shown',
    'tournament_interstitial_cooldown',
    'tournament_level_started',      -- NEW (linear)
    'tournament_level_completed',    -- NEW (linear)
    
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

-- (Optional) index helpers could be added here; skipping to keep migration minimal.


