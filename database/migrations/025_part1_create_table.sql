-- ============================================================================
-- MIGRATION 025 - PART 1: Create partitioned table structure
-- ============================================================================

CREATE TABLE IF NOT EXISTS events_partitioned (
  id UUID DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  campaign_id VARCHAR(255),
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_attempts INT DEFAULT 0,
  processing_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id, received_at),
  CONSTRAINT valid_event_type CHECK (
    event_type IN (
      -- User Lifecycle (7 events)
      'app_installed', 'app_launched', 'user_registered', 'user_installed', 'user_acquired',
      'nickname_changed', 'settings_changed', 'app_uninstalled',
      
      -- Rate Us Events (9 events)
      'rate_us_initialized', 'rate_us_popup_shown', 'rate_us_rate_tapped',
      'rate_us_prompt_shown', 'rate_us_store_opened', 'rate_us_maybe_later',
      'rate_us_declined', 'rate_us_completed',
      
      -- Game Session (8 events)
      'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used',
      'level_started', 'level_completed', 'level_failed', 'level_unlocked',
      'bonus_collected',
      
      -- Economy & Purchases (10 events)
      'currency_earned', 'currency_spent', 'purchase_initiated', 'purchase_completed',
      'skin_purchased', 'no_ads_purchased', 'currency_bundle_purchased', 'bundle_purchased',
      'special_offer_purchased',
      
      -- Progression (9 events)
      'skin_unlocked', 'skin_equipped', 'achievement_unlocked', 'achievement_claimed',
      'mission_unlocked', 'mission_completed',
      'item_unlocked', 'item_equipped',
      'prize_available', 'prize_claimed',
      
      -- Daily Streak (4 events)
      'daily_streak_claimed', 'daily_streak_cycle_completed', 'daily_streak_milestone',
      'daily_streak_broken',
      
      -- Powerups (2 events)
      'powerup_activated', 'powerup_expired',
      
      -- Tournament Events (12 events)
      'tournament_entered', 'tournament_round_started', 'tournament_level_started',
      'tournament_level_completed', 'tournament_start_over', 'tournament_game_over_dismissed',
      'tournament_completed', 'tournament_abandoned',
      'playoff_battle_started', 'playoff_battle_won', 'playoff_battle_lost',
      'tournament_manager_initialized',
      
      -- Ad Events (6 events)
      'ad_revenue', 'ad_watched', 'interstitial_shown', 'interstitial_dismissed',
      'interstitial_clicked', 'loss_streak_ad_shown',
      'tournament_interstitial_cooldown', 'tournament_interstitial_shown',
      
      -- Social & Engagement (3 events)
      'leaderboard_viewed', 'share_clicked', 'notification_received',
      
      -- Performance Events (5 events)
      'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
      'app_crashed', 'app_error',
      
      -- Conversion Events (8 events - dynamic pattern)
      'conversion_games_played_3', 'conversion_games_played_5', 'conversion_games_played_10',
      'conversion_sessions_3', 'conversion_sessions_6',
      'conversion_level_completed_3', 'conversion_level_completed_5', 'conversion_level_completed_10'
    )
    OR event_type LIKE 'conversion_%'
  ),
  CONSTRAINT valid_user_id CHECK (LENGTH(user_id) > 0),
  CONSTRAINT valid_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT valid_attempts CHECK (processing_attempts >= 0),
  CONSTRAINT valid_campaign_id CHECK (campaign_id IS NULL OR LENGTH(campaign_id) > 0)
) PARTITION BY RANGE (received_at);

SELECT 'Part 1 completed: Partitioned table created' AS status;

