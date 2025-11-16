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
  session_id: Joi.string().optional(), // ✅ FIX: Allow session_id from EventBus
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
  country: Joi.string().length(2).required(),
  timezone: Joi.string().optional(),
  install_source: Joi.string().required(), // 'organic', 'facebook_ads', etc.
});

// 2. app_launched - Every app open
const appLaunchedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('app_launched').required(),
  session_number: Joi.number().integer().min(1).required(),
  time_since_last_session: Joi.number().integer().min(0).required(), // seconds
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
  country: Joi.string().optional(),
  timezone: Joi.string().optional(),
  install_source: Joi.string().optional(),
  referrer: Joi.string().optional(),
  first_open: Joi.boolean().optional(),
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
  hearts_remaining: Joi.number().integer().min(0).max(10).required(),
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
  hearts_remaining: Joi.number().integer().min(0).max(10).required(),
  cause_of_death: Joi.string().required(), // 'obstacle_collision', 'quit', etc.
  max_combo: Joi.number().integer().min(0).required(),
  powerups_used: Joi.array().items(Joi.string()).default([]),
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
  hearts_remaining: Joi.number().integer().min(0).max(10).required(),
  is_first_attempt: Joi.boolean().required(),
});

// 12. level_completed - Story mode level done
const levelCompletedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('level_completed').required(),
  level_id: Joi.number().integer().min(1).required(),
  zone_id: Joi.number().integer().min(1).required(),
  score: Joi.number().integer().min(0).required(),
  stars: Joi.number().integer().min(0).max(3).required(),
  time_seconds: Joi.number().integer().min(0).required(),
  hearts_remaining: Joi.number().integer().min(0).max(10).required(),
  first_attempt: Joi.boolean().required(),
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
  hearts_remaining: Joi.number().integer().min(0).max(10).required(),
  continues_used: Joi.number().integer().min(0).required(),
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

// 20. achievement_unlocked - Achievement earned (NEW)
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

// 21. mission_completed - Daily mission done (NEW)
const missionCompletedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('mission_completed').required(),
  mission_id: Joi.string().required(),
  mission_type: Joi.string().required(), // 'MissionType.playGames', etc.
  mission_difficulty: Joi.string().required(), // 'MissionDifficulty.easy', etc.
  reward_coins: Joi.number().integer().min(0).required(),
  completion_time_seconds: Joi.number().integer().min(0).required(),
});

// 22. daily_streak_claimed - Daily reward claimed
const dailyStreakClaimedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('daily_streak_claimed').required(),
  streak_day: Joi.number().integer().min(1).max(7).required(),
  coins_reward: Joi.number().integer().min(0).required(),
  gems_reward: Joi.number().integer().min(0).optional(),
  streak_reset: Joi.boolean().optional(),
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

// 27. share_clicked - Social share
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
// SCHEMA MAP (for quick lookup by event_type)
// ============================================================================

const schemaMap = {
  // User Lifecycle
  app_installed: appInstalledSchema,
  app_launched: appLaunchedSchema,
  user_registered: userRegisteredSchema,
  settings_changed: settingsChangedSchema,
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
  currency_spent: currencySpentSchema,
  purchase_initiated: purchaseInitiatedSchema,
  purchase_completed: purchaseCompletedSchema,
  
  // Progression
  skin_unlocked: skinUnlockedSchema,
  skin_equipped: skinEquippedSchema,
  achievement_unlocked: achievementUnlockedSchema,
  mission_completed: missionCompletedSchema,
  daily_streak_claimed: dailyStreakClaimedSchema,
  level_unlocked: levelUnlockedSchema,
  
  // Social & Engagement
  leaderboard_viewed: leaderboardViewedSchema,
  tournament_entered: tournamentEnteredSchema,
  ad_watched: adWatchedSchema,
  share_clicked: shareClickedSchema,
  notification_received: notificationReceivedSchema,
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
  currencySpentSchema,
  purchaseInitiatedSchema,
  purchaseCompletedSchema,
  skinUnlockedSchema,
  skinEquippedSchema,
  achievementUnlockedSchema,
  missionCompletedSchema,
  dailyStreakClaimedSchema,
  levelUnlockedSchema,
  leaderboardViewedSchema,
  tournamentEnteredSchema,
  adWatchedSchema,
  shareClickedSchema,
  notificationReceivedSchema,
  
  // Schema map and validation
  schemaMap,
  validateEvent,
};

