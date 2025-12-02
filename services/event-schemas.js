/**
 * Event Validation Schemas
 * Joi schemas for all 28 Flutter events
 * 
 * These schemas match EXACTLY with Flutter EventBus event payloads
 * from CLIENT_ONLY_WITH_EVENT_DRIVEN_ANALYTICS.md and BACKEND_API_SPECIFICATION.md
 */

const Joi = require('joi');

// ============================================================================
// BASE SCHEMA (all events have these fields)
// ============================================================================

const baseFields = {
  event_type: Joi.string().required(),
  user_id: Joi.string().min(1).max(255).required(),
  timestamp: Joi.string().isoDate().required(),
  app_version: Joi.string().required(),
  platform: Joi.string().valid('ios', 'android').required(),
  session_id: Joi.string().optional(),
  // Locale from Flutter (device language preference, e.g., "en_US", "he_IL")
  // This is NOT geographic location - just user's language setting
  locale: Joi.string().max(20).optional(),
  // Country from backend IP geolocation (added server-side, not from Flutter)
  // Kept optional for backward compatibility with older app versions
  country: Joi.string().length(2).optional(),
};

// ============================================================================
// USER LIFECYCLE EVENTS (5 events)
// ============================================================================

// 1. app_installed - First app launch
const appInstalledSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('app_installed').required(),
  device_model: Joi.string().required(),
  os_version: Joi.string().required(),
  timezone: Joi.string().optional(),
  install_source: Joi.string().required(), // 'organic', 'facebook_ads', etc.
});

// 2. app_launched - Every app open
const appLaunchedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('app_launched').required(),
  // ✅ FIX: Flutter client sends these from getDeviceMetadata()
  deviceModel: Joi.string().optional(),
  osVersion: Joi.string().optional(),
  appVersion: Joi.string().optional(),
  nickname: Joi.string().max(50).optional(), // ✅ NEW: Player nickname (1-50 chars)
  // ✅ FIX: Flutter client sends these from getSessionMetadata()
  daysSinceInstall: Joi.number().integer().min(0).optional(),
  daysSinceLastSession: Joi.number().integer().min(0).optional(),
  isFirstLaunch: Joi.boolean().optional(),
  // ❌ DEPRECATED: Backend expected these but Flutter doesn't send them
  // session_number: Joi.number().integer().min(1).required(),
  // time_since_last_session: Joi.number().integer().min(0).required(), // seconds
});

// 3. user_registered - Device ID created
const userRegisteredSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('user_registered').required(),
  registration_method: Joi.string().valid('device_id', 'anonymous').required(),
});

// 4. settings_changed - User preferences updated
const settingsChangedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('settings_changed').required(),
  setting_name: Joi.string().required(),
  old_value: Joi.any().optional(),
  new_value: Joi.any().required(),
});

// 4b. nickname_changed - Player nickname updated
// ✅ CRITICAL: Backend updates `users` table when receiving this event
// This ensures push notifications use the correct personalized nickname
const nicknameChangedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('nickname_changed').required(),
  new_nickname: Joi.string().min(2).max(20).required(),
  old_nickname: Joi.string().max(20).optional(),
});

// 5. app_uninstalled - Tracked via backend (no Flutter payload)
const appUninstalledSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('app_uninstalled').required(),
  last_seen_at: Joi.string().isoDate().required(),
});

// 6. user_installed - User installation event (similar to app_installed)
const userInstalledSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('user_installed').required(),
  device_model: Joi.string().optional(),
  os_version: Joi.string().optional(),
  timezone: Joi.string().optional(),
  install_source: Joi.string().optional(),
  referrer: Joi.string().optional(),
  first_open: Joi.boolean().optional(),
  nickname: Joi.string().max(50).optional(), // Player nickname (1-50 chars)
}).unknown(true); // Allow additional fields

// ============================================================================
// GAME SESSION EVENTS (8 events)
// ============================================================================

// 6. game_started - Game begins
const gameStartedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('game_started').required(),
  game_mode: Joi.string().valid('endless', 'story').required(),
  selected_jet: Joi.string().required(),
  selected_skin: Joi.string().optional(),
  hearts_remaining: Joi.number().integer().max(10).required(), // Allow negative, clamped to 0 in processor
  powerups_active: Joi.array().items(Joi.string()).default([]),
});

// 7. game_ended - Game over (HIGH PRIORITY - updates leaderboards!)
const gameEndedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('game_ended').required(),
  game_mode: Joi.string().valid('endless', 'story').required(),
  score: Joi.number().integer().min(0).required(),
  duration_seconds: Joi.number().integer().min(0).required(),
  obstacles_dodged: Joi.number().integer().min(0).required(),
  coins_collected: Joi.number().integer().min(0).required(),
  gems_collected: Joi.number().integer().min(0).required(),
  hearts_remaining: Joi.number().integer().max(10).required(), // Allow negative, clamped to 0 in processor
  cause_of_death: Joi.string().required(), // 'obstacle_collision', 'quit', etc.
  max_combo: Joi.number().integer().min(0).required(),
  powerups_used: Joi.array().items(Joi.string()).default([]),
  // Story mode specific fields (optional)
  level_id: Joi.number().integer().min(1).optional(),
  zone_id: Joi.number().integer().min(1).optional(),
  level_name: Joi.string().optional(),
});

// 8. game_paused - Mid-game pause
const gamePausedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('game_paused').required(),
  game_mode: Joi.string().valid('endless', 'story').required(),
  score_at_pause: Joi.number().integer().min(0).required(),
  time_played_seconds: Joi.number().integer().min(0).required(),
});

// 9. game_resumed - Resume from pause
const gameResumedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('game_resumed').required(),
  game_mode: Joi.string().valid('endless', 'story').required(),
  pause_duration_seconds: Joi.number().integer().min(0).required(),
});

// 10. continue_used - Ad watch/continue purchase (NEW)
const continueUsedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('continue_used').required(),
  game_mode: Joi.string().valid('endless', 'story').required(),
  score_at_death: Joi.number().integer().min(0).required(),
  continue_type: Joi.string().valid('ad_watch', 'gem_purchase', 'coin_purchase').required(),
  cost_coins: Joi.number().integer().min(0).required(),
  cost_gems: Joi.number().integer().min(0).required(),
  lives_restored: Joi.number().integer().min(1).required(),
  continues_used_this_run: Joi.number().integer().min(1).required(),
});

// 11. level_started - Story mode level start (NEW)
const levelStartedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('level_started').required(),
  level_id: Joi.number().integer().min(1).required(),
  zone_id: Joi.number().integer().min(1).required(),
  level_name: Joi.string().required(),
  difficulty: Joi.string().required(),
  objective_type: Joi.string().required(),
  attempt_number: Joi.number().integer().min(1).required(),
  hearts_remaining: Joi.number().integer().max(10).required(), // Allow negative, clamped to 0 in processor
  is_first_attempt: Joi.boolean().required(),
});

// 12. level_completed - Story mode level done
const levelCompletedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('level_completed').required(),
  level_id: Joi.number().integer().min(1).required(),
  zone_id: Joi.number().integer().min(1).required(),
  score: Joi.number().integer().min(0).required(),
  stars: Joi.number().integer().min(0).max(3).default(0), // Optional - we don't track stars currently
  time_seconds: Joi.number().integer().min(0).required(),
  hearts_remaining: Joi.number().integer().max(10).required(), // Allow negative, clamped to 0 in processor
  first_attempt: Joi.boolean().required(),
  // Additional optional fields for enhanced analytics
  level_name: Joi.string().optional(),
  objective_type: Joi.string().optional(),
  continues_used: Joi.number().integer().min(0).default(0),
});

// 13. level_failed - Story mode level failed (NEW)
const levelFailedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('level_failed').required(),
  level_id: Joi.number().integer().min(1).required(),
  zone_id: Joi.number().integer().min(1).required(),
  level_name: Joi.string().required(),
  score: Joi.number().integer().min(0).required(),
  objective_target: Joi.number().integer().min(0).required(),
  objective_type: Joi.string().required(),
  cause_of_death: Joi.string().required(),
  time_survived_seconds: Joi.number().integer().min(0).required(),
  hearts_remaining: Joi.number().integer().max(10).required(), // Allow negative, clamped to 0 in processor
  continues_used: Joi.number().integer().min(0).required(),
  is_first_attempt: Joi.boolean().optional(), // ✅ NEW: Track if this was user's first attempt
});

// ============================================================================
// ECONOMY EVENTS (4 events)
// ============================================================================

// 14. currency_earned - Coins/gems earned (NEW)
const currencyEarnedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('currency_earned').required(),
  currency_type: Joi.string().valid('coins', 'gems').required(),
  amount: Joi.number().integer().min(1).required(),
  source: Joi.string().required(), // 'game_reward', 'mission_reward', 'level_reward', 'prize_claimed', etc.
  source_id: Joi.string().required(), // mission_id, level_id, prize_id, etc.
  balance_before: Joi.number().integer().min(0).required(),
  balance_after: Joi.number().integer().min(0).required(),
});

// 14b. bonus_collected - In-game bonus collected (shields, coins, gems)
const bonusCollectedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('bonus_collected').required(),
  bonus_type: Joi.string().valid('shield', 'coins', 'gems').required(),
  level_id: Joi.number().integer().min(1).allow(null).optional(),
  zone_id: Joi.number().integer().min(1).allow(null).optional(),
  score_at_collection: Joi.number().integer().min(0).required(),
  // Shield-specific fields
  shield_tier: Joi.string().valid('blue', 'red', 'green').optional(),
  shield_duration: Joi.number().min(0).optional(),
  // Currency-specific fields
  amount: Joi.number().integer().min(1).optional(),
});

// 15. currency_spent - Coins/gems spent (NEW)
const currencySpentSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('currency_spent').required(),
  currency_type: Joi.string().valid('coins', 'gems').required(),
  amount: Joi.number().integer().min(1).required(),
  spent_on: Joi.string().required(), // 'skin_purchase', 'continue_purchase', 'booster_purchase', etc.
  item_id: Joi.string().required(), // jet_id, booster_id, etc.
  balance_before: Joi.number().integer().min(0).required(),
  balance_after: Joi.number().integer().min(0).required(),
});

// 15a. skin_purchased - Skin/jet purchase with coins or gems
const skinPurchasedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('skin_purchased').required(),
  jet_id: Joi.string().required(),
  jet_name: Joi.string().optional(),
  purchase_type: Joi.string().valid('coins', 'gems').required(),
  cost_coins: Joi.number().integer().min(0).required(),
  cost_gems: Joi.number().integer().min(0).required(),
  rarity: Joi.string().optional(),
});

// 15b. item_unlocked - Any item unlocked (skin, achievement, etc)
const itemUnlockedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('item_unlocked').required(),
  item_type: Joi.string().required(), // 'skin', 'achievement', 'booster', etc.
  item_id: Joi.string().required(),
  item_name: Joi.string().optional(),
  unlock_method: Joi.string().optional(), // 'purchase', 'achievement', 'mission_reward', etc.
  acquisition_method: Joi.string().optional(), // ✅ FIX: Accept acquisition_method (Flutter sends this)
});

// 15c. item_equipped - Item equipped (skin, booster, etc)
const itemEquippedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('item_equipped').required(),
  item_type: Joi.string().required(), // 'skin', 'booster', etc.
  item_id: Joi.string().required(),
  item_name: Joi.string().optional(),
});

// 16. purchase_initiated - IAP start
const purchaseInitiatedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('purchase_initiated').required(),
  product_id: Joi.string().required(),
  product_type: Joi.string().valid('consumable', 'non_consumable', 'subscription').required(),
  price_usd: Joi.number().min(0).required(),
  currency_code: Joi.string().length(3).required(),
});

// 17. purchase_completed - IAP success
const purchaseCompletedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('purchase_completed').required(),
  product_id: Joi.string().required(),
  product_type: Joi.string().valid('consumable', 'non_consumable', 'subscription').required(),
  price_usd: Joi.number().min(0).required(),
  currency_code: Joi.string().length(3).required(),
  transaction_id: Joi.string().required(),
  gems_granted: Joi.number().integer().min(0).optional(),
  coins_granted: Joi.number().integer().min(0).optional(),
});

// ============================================================================
// PROGRESSION EVENTS (6 events)
// ============================================================================

// 18. skin_unlocked - New jet unlocked
const skinUnlockedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('skin_unlocked').required(),
  skin_id: Joi.string().required(),
  skin_name: Joi.string().required(),
  unlock_method: Joi.string().valid('purchase', 'reward', 'achievement').required(),
  cost_coins: Joi.number().integer().min(0).optional(),
  cost_gems: Joi.number().integer().min(0).optional(),
});

// 19. skin_equipped - Jet equipped
const skinEquippedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('skin_equipped').required(),
  skin_id: Joi.string().required(),
  skin_name: Joi.string().required(),
  previous_skin_id: Joi.string().optional(),
});

// 20. achievement_unlocked - Achievement criteria met (can be claimed)
const achievementUnlockedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('achievement_unlocked').required(),
  achievement_id: Joi.string().required(),
  achievement_name: Joi.string().required(),
  achievement_tier: Joi.string().required(), // 'AchievementRarity.common', etc.
  achievement_category: Joi.string().required(), // 'AchievementCategory.gameplay', etc.
  reward_coins: Joi.number().integer().min(0).required(),
  reward_gems: Joi.number().integer().min(0).required(),
});

// 20b. achievement_claimed - Achievement reward claimed by user (NEW)
const achievementClaimedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('achievement_claimed').required(),
  achievement_id: Joi.string().required(),
  achievement_name: Joi.string().required(),
  achievement_tier: Joi.string().required(), // 'AchievementRarity.common', etc.
  achievement_category: Joi.string().required(), // 'AchievementCategory.gameplay', etc.
  reward_coins: Joi.number().integer().min(0).required(),
  reward_gems: Joi.number().integer().min(0).required(),
  time_to_claim_seconds: Joi.number().integer().min(0).required(), // Time between unlock and claim
});

// 21. mission_unlocked - Mission criteria met (can be claimed) (NEW)
const missionUnlockedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('mission_unlocked').required(),
  mission_id: Joi.string().required(),
  mission_type: Joi.string().required(), // 'MissionType.playGames', etc.
  mission_difficulty: Joi.string().required(), // 'MissionDifficulty.easy', etc.
  mission_title: Joi.string().required(),
  reward_coins: Joi.number().integer().min(0).required(),
  target: Joi.number().integer().min(1).required(),
  progress: Joi.number().integer().min(0).required(),
});

// 21b. mission_completed - Mission reward claimed by user (renamed from "mission done")
const missionCompletedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('mission_completed').required(),
  mission_id: Joi.string().required(),
  mission_type: Joi.string().required(), // 'MissionType.playGames', etc.
  mission_difficulty: Joi.string().required(), // 'MissionDifficulty.easy', etc.
  reward_coins: Joi.number().integer().min(0).required(),
  completion_time_seconds: Joi.number().integer().min(0).required(), // Time between unlock and claim
});

// 22. daily_streak_claimed - Daily reward claimed (UPDATED to match Flutter EventBus)
const dailyStreakClaimedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('daily_streak_claimed').required(),
  day_in_cycle: Joi.number().integer().min(1).max(7).required(), // 1-7
  current_streak: Joi.number().integer().min(1).required(),       // Total consecutive days
  current_cycle: Joi.number().integer().min(0).required(),        // Which 7-day cycle (0-indexed)
  reward_type: Joi.string().required(),                            // 'coins', 'gems', 'heartBooster', etc.
  reward_amount: Joi.number().integer().min(0).required(),        // Numeric value
  reward_set: Joi.string().valid('new_player', 'experienced').required(),
});

// 22b. daily_streak_milestone - Special streak milestones (7, 14, 30, 60, 100 days)
const dailyStreakMilestoneSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('daily_streak_milestone').required(),
  milestone_days: Joi.number().integer().valid(7, 14, 30, 60, 100).required(),
  current_cycle: Joi.number().integer().min(0).required(),
  total_cycles_completed: Joi.number().integer().min(0).required(),
});

// 22c. daily_streak_broken - User broke their streak (missed a day)
const dailyStreakBrokenSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('daily_streak_broken').required(),
  last_streak_days: Joi.number().integer().min(1).required(),
  last_cycle: Joi.number().integer().min(0).required(),
  total_cycles_completed: Joi.number().integer().min(0).required(),
});

// 22d. daily_streak_cycle_completed - User completed a full 7-day cycle
const dailyStreakCycleCompletedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('daily_streak_cycle_completed').required(),
  cycle_number: Joi.number().integer().min(1).required(),
  total_cycles_completed: Joi.number().integer().min(0).required(),
  reward_set: Joi.string().valid('new_player', 'experienced').required(),
});

// 23. level_unlocked - Story level unlocked
const levelUnlockedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('level_unlocked').required(),
  level_id: Joi.number().integer().min(1).required(),
  zone_id: Joi.number().integer().min(1).required(),
  level_name: Joi.string().required(),
  unlock_method: Joi.string().valid('progression', 'purchase').required(),
});

// ============================================================================
// SOCIAL & ENGAGEMENT EVENTS (5 events)
// ============================================================================

// 24. leaderboard_viewed - User checks leaderboard
const leaderboardViewedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('leaderboard_viewed').required(),
  leaderboard_type: Joi.string().valid('global', 'tournament', 'friends').required(),
  user_rank: Joi.number().integer().min(0).optional(),
});

// 25. tournament_entered - Implicit from game_ended in endless mode
const tournamentEnteredSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('tournament_entered').required(),
  tournament_id: Joi.string().required(),
  tournament_name: Joi.string().required(),
});

// 26. ad_watched - Rewarded ad
const adWatchedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('ad_watched').required(),
  ad_type: Joi.string().valid('rewarded', 'interstitial', 'banner').required(),
  ad_placement: Joi.string().required(), // 'game_over', 'store', etc.
  reward_type: Joi.string().optional(), // 'coins', 'gems', 'continue'
  reward_amount: Joi.number().integer().min(0).optional(),
});

// 27. interstitial_shown - Interstitial ad displayed
const interstitialShownSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('interstitial_shown').required(),
  wins_this_session: Joi.number().integer().min(0).optional(),
  lifetime_wins: Joi.number().integer().min(0).optional(),
  time_since_last_ad: Joi.number().integer().min(0).allow(null).optional(), // seconds
  trigger_reason: Joi.string().valid('win_milestone', 'loss_streak', 'unknown').optional(), // 📊 NEW: Differentiate win vs loss ads
});

// 28. interstitial_dismissed - Interstitial ad closed
const interstitialDismissedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('interstitial_dismissed').required(),
  wins_this_session: Joi.number().integer().min(0).optional(),
  view_duration_seconds: Joi.number().integer().min(0).allow(null).optional(), // How long user viewed ad
  is_early_dismissal: Joi.boolean().optional(), // true if viewed < 5 seconds (potential revenue loss)
  was_clicked: Joi.boolean().optional(), // true if user clicked the ad (good engagement!)
  trigger_reason: Joi.string().valid('win_milestone', 'loss_streak', 'unknown').optional(), // 📊 NEW: Differentiate win vs loss ads
});

// 28b. interstitial_clicked - User clicked on interstitial ad (good engagement!)
const interstitialClickedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('interstitial_clicked').required(),
  wins_this_session: Joi.number().integer().min(0).optional(),
  lifetime_wins: Joi.number().integer().min(0).optional(),
});

// 28d. loss_streak_ad_shown - Loss streak triggered interstitial ad (NEW)
// This is a separate event fired when the ad is triggered by 3 consecutive losses
const lossStreakAdShownSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('loss_streak_ad_shown').required(),
  consecutive_losses: Joi.number().integer().min(0).optional(),
  lifetime_wins: Joi.number().integer().min(0).optional(),
});

// 28e. loss_streak_ad_pending - Loss streak ad is queued to show (NEW)
const lossStreakAdPendingSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('loss_streak_ad_pending').required(),
  consecutive_losses: Joi.number().integer().min(0).optional(),
  lifetime_wins: Joi.number().integer().min(0).optional(),
});

// 28c. ad_revenue - Track REAL ad revenue via AdMob's onPaidEvent callback
// This provides actual revenue data from AdMob, not estimates!
const adRevenueSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('ad_revenue').required(),
  ad_type: Joi.string().valid('interstitial', 'rewarded', 'banner').required(),
  ad_format: Joi.string().optional(), // 'fullscreen', 'rewarded_video', etc.
  
  // NEW: Real revenue from AdMob's onPaidEvent (preferred)
  revenue_micros: Joi.number().min(0).optional(), // Revenue in micros (millionths)
  revenue_usd: Joi.number().min(0).optional(), // Revenue in USD (calculated)
  precision: Joi.string().valid('precise', 'estimated', 'publisherProvided', 'unknown').optional(),
  is_real_revenue: Joi.boolean().optional(), // true = from onPaidEvent, false/missing = estimate
  
  // LEGACY: Old estimated revenue (for backward compatibility)
  estimated_revenue_usd: Joi.number().min(0).optional(), // Old estimate field
  
  currency: Joi.string().length(3).default('USD'), // ISO currency code
  reward_granted: Joi.boolean().optional(), // For rewarded ads
});

// 29. share_clicked - Social share
const shareClickedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('share_clicked').required(),
  share_type: Joi.string().valid('score', 'achievement', 'invite').required(),
  platform: Joi.string().optional(), // 'facebook', 'twitter', etc.
  score_shared: Joi.number().integer().min(0).optional(),
});

// 28. notification_received - Push notification
const notificationReceivedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('notification_received').required(),
  notification_type: Joi.string().required(),
  notification_title: Joi.string().optional(),
  opened: Joi.boolean().required(),
});

// ============================================================================
// PRIZE EVENTS (2 events)
// ============================================================================

// 30. prize_available - New prizes ready to claim (tournament/leaderboard rewards)
const prizeAvailableSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('prize_available').required(),
  count: Joi.number().integer().min(1).required(),      // Number of prizes available
  total_coins: Joi.number().integer().min(0).required(), // Total coins across all prizes
  total_gems: Joi.number().integer().min(0).required(),  // Total gems across all prizes
});

// 31. prize_claimed - User claimed a prize
const prizeClaimedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('prize_claimed').required(),
  prize_id: Joi.string().required(),
  tournament_id: Joi.string().required(),
  tournament_name: Joi.string().required(),
  rank: Joi.number().integer().min(1).required(),
  coins: Joi.number().integer().min(0).required(),
  gems: Joi.number().integer().min(0).required(),
  claimed_at: Joi.string().isoDate().required(),
});

// ============================================================================
// RATE US EVENTS (9 events) - ⭐ NEW: App rating funnel tracking
// ============================================================================

// 32. rate_us_initialized - Rate us manager initialized
const rateUsInitializedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_initialized').required(),
  session_count: Joi.number().integer().min(0).required(),
  has_rated: Joi.boolean().required(),
  has_declined: Joi.boolean().required(), // ✅ FIX: Added missing field
  prompt_count: Joi.number().integer().min(0).required(),
  days_since_install: Joi.number().integer().min(0).required(),
});

// 33. rate_us_trigger - Rate us trigger point reached
const rateUsTriggerSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_trigger').required(),
  trigger_type: Joi.string().valid('positive_experience', 'daily_streak', 'achievement', 'manual').required(),
  session_count: Joi.number().integer().min(0).required(),
  streak_day: Joi.number().integer().min(0).optional(), // For daily_streak trigger
});

// 34. rate_us_popup_shown - Rate us popup displayed
const rateUsPopupShownSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_popup_shown').required(),
  session_count: Joi.number().integer().min(0).required(),
  days_since_install: Joi.number().integer().min(0).required(),
});

// 35. rate_us_prompt_shown - Native rating prompt shown
const rateUsPromptShownSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_prompt_shown').required(),
  session_count: Joi.number().integer().min(0).required(),
  prompt_count: Joi.number().integer().min(0).required(),
  days_since_install: Joi.number().integer().min(0).required(),
});

// 36. rate_us_rate_tapped - User tapped Rate button
const rateUsRateTappedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_rate_tapped').required(),
  session_count: Joi.number().integer().min(0).required(),
});

// 37. rate_us_maybe_later - User tapped Maybe Later
const rateUsMaybeLaterSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_maybe_later').required(),
  session_count: Joi.number().integer().min(0).required(),
});

// 38. rate_us_declined - User tapped No Thanks (won't show again)
const rateUsDeclinedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_declined').required(),
  session_count: Joi.number().integer().min(0).required(),
});

// 39. rate_us_completed - User completed rating
const rateUsCompletedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_completed').required(),
  session_count: Joi.number().integer().min(0).required(),
  prompt_count: Joi.number().integer().min(0).required(),
  days_since_install: Joi.number().integer().min(0).required(),
});

// 40. rate_us_store_opened - Store listing opened
const rateUsStoreOpenedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('rate_us_store_opened').required(),
  session_count: Joi.number().integer().min(0).required(),
  trigger: Joi.string().valid('manual', 'fallback').required(),
});

// ============================================================================
// SCHEMA MAP (for quick lookup by event_type)
// ============================================================================

const schemaMap = {
  // User Lifecycle
  app_installed: appInstalledSchema,
  app_launched: appLaunchedSchema,
  user_registered: userRegisteredSchema,
  settings_changed: settingsChangedSchema,
  nickname_changed: nicknameChangedSchema, // ✅ NEW: Nickname updates (updates users table)
  app_uninstalled: appUninstalledSchema,
  user_installed: userInstalledSchema, // ✅ NEW: Add user_installed event
  
  // Game Session
  game_started: gameStartedSchema,
  game_ended: gameEndedSchema,
  game_paused: gamePausedSchema,
  game_resumed: gameResumedSchema,
  continue_used: continueUsedSchema,
  level_started: levelStartedSchema,
  level_completed: levelCompletedSchema,
  level_failed: levelFailedSchema,
  
  // Economy
  currency_earned: currencyEarnedSchema,
  bonus_collected: bonusCollectedSchema, // 🎁 NEW: In-game bonus collection
  currency_spent: currencySpentSchema,
  skin_purchased: skinPurchasedSchema, // ✅ NEW: Skin purchase event
  item_unlocked: itemUnlockedSchema,   // ✅ NEW: Item unlock event
  item_equipped: itemEquippedSchema,   // ✅ NEW: Item equip event
  purchase_initiated: purchaseInitiatedSchema,
  purchase_completed: purchaseCompletedSchema,
  
  // Progression
  skin_unlocked: skinUnlockedSchema,
  skin_equipped: skinEquippedSchema,
  achievement_unlocked: achievementUnlockedSchema,
  achievement_claimed: achievementClaimedSchema,
  mission_unlocked: missionUnlockedSchema,
  mission_completed: missionCompletedSchema,
  daily_streak_claimed: dailyStreakClaimedSchema,
  daily_streak_milestone: dailyStreakMilestoneSchema,
  daily_streak_broken: dailyStreakBrokenSchema,
  daily_streak_cycle_completed: dailyStreakCycleCompletedSchema,
  level_unlocked: levelUnlockedSchema,
  prize_available: prizeAvailableSchema,
  prize_claimed: prizeClaimedSchema,
  
  // Social & Engagement
  leaderboard_viewed: leaderboardViewedSchema,
  tournament_entered: tournamentEnteredSchema,
  ad_watched: adWatchedSchema,
  interstitial_shown: interstitialShownSchema,
  interstitial_dismissed: interstitialDismissedSchema,
  interstitial_clicked: interstitialClickedSchema,
  loss_streak_ad_shown: lossStreakAdShownSchema,       // 📊 NEW: Loss streak ad triggered
  loss_streak_ad_pending: lossStreakAdPendingSchema,   // 📊 NEW: Loss streak ad queued
  ad_revenue: adRevenueSchema,
  share_clicked: shareClickedSchema,
  notification_received: notificationReceivedSchema,
  
  // ⭐ Rate Us Events (NEW)
  rate_us_initialized: rateUsInitializedSchema,
  rate_us_trigger: rateUsTriggerSchema,
  rate_us_popup_shown: rateUsPopupShownSchema,
  rate_us_prompt_shown: rateUsPromptShownSchema,
  rate_us_rate_tapped: rateUsRateTappedSchema,
  rate_us_maybe_later: rateUsMaybeLaterSchema,
  rate_us_declined: rateUsDeclinedSchema,
  rate_us_completed: rateUsCompletedSchema,
  rate_us_store_opened: rateUsStoreOpenedSchema,
};

// ============================================================================
// VALIDATION HELPER
// ============================================================================

/**
 * Validate an event against its schema
 * @param {Object} event - Event object to validate
 * @returns {Object} - { valid: boolean, errors: array }
 */
function validateEvent(event) {
  const { event_type } = event;
  
  if (!event_type) {
    return {
      valid: false,
      errors: ['Missing required field: event_type']
    };
  }
  
  const schema = schemaMap[event_type];
  
  if (!schema) {
    return {
      valid: false,
      errors: [`Unknown event type: ${event_type}`]
    };
  }
  
  const { error } = schema.validate(event, { abortEarly: false });
  
  if (error) {
    return {
      valid: false,
      errors: error.details.map(d => d.message)
    };
  }
  
  return { valid: true };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Individual schemas
  appInstalledSchema,
  appLaunchedSchema,
  userRegisteredSchema,
  settingsChangedSchema,
  nicknameChangedSchema, // ✅ NEW: Nickname change event
  appUninstalledSchema,
  userInstalledSchema, // ✅ NEW: Export user_installed schema
  gameStartedSchema,
  gameEndedSchema,
  gamePausedSchema,
  gameResumedSchema,
  continueUsedSchema,
  levelStartedSchema,
  levelCompletedSchema,
  levelFailedSchema,
  currencyEarnedSchema,
  bonusCollectedSchema,   // 🎁 NEW: Export bonus collected schema
  currencySpentSchema,
  skinPurchasedSchema,    // ✅ NEW: Export skin purchase schema
  itemUnlockedSchema,     // ✅ NEW: Export item unlock schema
  itemEquippedSchema,     // ✅ NEW: Export item equip schema
  purchaseInitiatedSchema,
  purchaseCompletedSchema,
  skinUnlockedSchema,
  skinEquippedSchema,
  achievementUnlockedSchema,
  achievementClaimedSchema,
  missionUnlockedSchema,
  missionCompletedSchema,
  dailyStreakClaimedSchema,
  dailyStreakMilestoneSchema,
  dailyStreakBrokenSchema,
  dailyStreakCycleCompletedSchema,
  levelUnlockedSchema,
  prizeAvailableSchema,
  prizeClaimedSchema,
  leaderboardViewedSchema,
  tournamentEnteredSchema,
  adWatchedSchema,
  interstitialShownSchema,      // 📊 Interstitial ad events
  interstitialDismissedSchema,
  interstitialClickedSchema,
  lossStreakAdShownSchema,      // 📊 Loss streak ad events
  lossStreakAdPendingSchema,
  adRevenueSchema,
  shareClickedSchema,
  notificationReceivedSchema,
  
  // Schema map and validation
  schemaMap,
  validateEvent,
};

