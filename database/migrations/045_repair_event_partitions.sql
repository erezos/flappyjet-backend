-- The weekly helper still attached partitions to events_partitioned after that
-- table was renamed to events. The last real week ended 2026-03-23, so every
-- later insert was rejected and the scoreboard stayed empty.

CREATE OR REPLACE FUNCTION create_weekly_partition(week_start DATE)
RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  week_end DATE;
BEGIN
  partition_name := get_weekly_partition_name(week_start);
  week_end := week_start + INTERVAL '7 days';

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
    partition_name, week_start, week_end
  );
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  week_start DATE := DATE '2026-03-23';
  last_week DATE := (DATE_TRUNC('week', CURRENT_DATE)::DATE + INTERVAL '12 weeks')::DATE;
BEGIN
  WHILE week_start <= last_week LOOP
    PERFORM create_weekly_partition(week_start);
    week_start := (week_start + INTERVAL '7 days')::DATE;
  END LOOP;
END $$;

ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;

ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    'app_installed', 'app_launched', 'user_registered', 'user_installed', 'user_acquired',
    'nickname_changed', 'settings_changed', 'app_uninstalled',
    'first_open', 'session_started', 'session_ended',
    'rate_us_initialized', 'rate_us_popup_shown', 'rate_us_rate_tapped',
    'rate_us_prompt_shown', 'rate_us_store_opened', 'rate_us_maybe_later',
    'rate_us_declined', 'rate_us_completed',
    'game_started', 'game_ended', 'game_paused', 'game_resumed', 'continue_used',
    'level_started', 'level_completed', 'level_failed', 'level_unlocked',
    'bonus_collected', 'powerup_activated', 'powerup_expired',
    'currency_earned', 'currency_spent', 'purchase_initiated', 'purchase_completed',
    'purchase_acknowledged', 'purchase_refunded',
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
    'tournament_manager_initialized', 'tournament_ticket_granted',
    'ad_watched', 'ad_revenue', 'ad_failed_to_load', 'ad_skipped',
    'interstitial_shown', 'interstitial_dismissed', 'interstitial_clicked',
    'loss_streak_ad_shown', 'tournament_interstitial_shown', 'tournament_interstitial_cooldown',
    'leaderboard_viewed', 'share_clicked', 'notification_received',
    'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
    'performance_metrics', 'app_load_time', 'game_load_time', 'memory_usage',
    'app_crashed', 'app_error'
  )
  OR event_type LIKE 'conversion_%'
);
