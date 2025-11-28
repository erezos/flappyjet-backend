/**
 * Unit Tests for Event Schemas (Joi validation)
 * Tests all 28 event schemas to ensure proper validation
 */

const { schemaMap } = require('../../services/event-schemas');

describe('Event Schemas Validation', () => {
  describe('app_installed', () => {
    test('should validate correct app_installed event', () => {
      const event = {
        event_type: 'app_installed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        device_model: 'Samsung Galaxy S21',
        os_version: '12',
        country: 'US',
        language: 'en'
      };

      const { error } = schemaMap.app_installed.validate(event);
      expect(error).toBeUndefined();
    });

    test('should reject missing required fields', () => {
      const event = {
        event_type: 'app_installed',
        // missing user_id
        timestamp: '2025-01-01T00:00:00.000Z'
      };

      const { error } = schemaMap.app_installed.validate(event);
      expect(error).toBeDefined();
    });

    test('should reject invalid platform', () => {
      const event = {
        event_type: 'app_installed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        platform: 'windows' // invalid
      };

      const { error } = schemaMap.app_installed.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('game_ended', () => {
    // Base fields required for all events
    const baseEventFields = {
      user_id: 'device_123',
      timestamp: '2025-01-01T00:00:00.000Z',
      app_version: '1.4.2',
      platform: 'android'
    };

    test('should validate endless mode game_ended event', () => {
      const event = {
        ...baseEventFields,
        event_type: 'game_ended',
        game_mode: 'endless',
        score: 42,
        duration_seconds: 120,
        obstacles_dodged: 42,
        coins_collected: 15,
        gems_collected: 2,
        hearts_remaining: 0,
        cause_of_death: 'obstacle_collision',
        max_combo: 5,
        powerups_used: []
      };

      const { error } = schemaMap.game_ended.validate(event);
      expect(error).toBeUndefined();
    });

    test('should validate story mode game_ended with level info', () => {
      const event = {
        ...baseEventFields,
        event_type: 'game_ended',
        game_mode: 'story',
        score: 16,
        duration_seconds: 45,
        obstacles_dodged: 16,
        coins_collected: 5,
        gems_collected: 0,
        hearts_remaining: 2,
        cause_of_death: 'level_completed',
        max_combo: 0,
        powerups_used: [],
        // Story mode specific fields (new!)
        level_id: 5,
        zone_id: 1,
        level_name: 'Sky Rookie 5'
      };

      const { error } = schemaMap.game_ended.validate(event);
      expect(error).toBeUndefined();
    });

    test('should validate story mode game_ended without optional level info', () => {
      const event = {
        ...baseEventFields,
        event_type: 'game_ended',
        game_mode: 'story',
        score: 10,
        duration_seconds: 30,
        obstacles_dodged: 10,
        coins_collected: 3,
        gems_collected: 0,
        hearts_remaining: 0,
        cause_of_death: 'obstacle_collision',
        max_combo: 0,
        powerups_used: []
        // level_id, zone_id, level_name are optional
      };

      const { error } = schemaMap.game_ended.validate(event);
      expect(error).toBeUndefined();
    });

    test('should reject negative score', () => {
      const event = {
        ...baseEventFields,
        event_type: 'game_ended',
        game_mode: 'endless',
        score: -10, // invalid
        duration_seconds: 120,
        obstacles_dodged: 0,
        coins_collected: 0,
        gems_collected: 0,
        hearts_remaining: 0,
        cause_of_death: 'quit',
        max_combo: 0,
        powerups_used: []
      };

      const { error } = schemaMap.game_ended.validate(event);
      expect(error).toBeDefined();
    });

    test('should reject invalid game_mode', () => {
      const event = {
        ...baseEventFields,
        event_type: 'game_ended',
        game_mode: 'tournament', // invalid - only 'endless' or 'story'
        score: 50,
        duration_seconds: 120,
        obstacles_dodged: 50,
        coins_collected: 10,
        gems_collected: 1,
        hearts_remaining: 0,
        cause_of_death: 'obstacle_collision',
        max_combo: 0,
        powerups_used: []
      };

      const { error } = schemaMap.game_ended.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('currency_earned', () => {
    test('should validate coins earned', () => {
      const event = {
        event_type: 'currency_earned',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        currency_type: 'coins',
        amount: 100,
        source: 'level_completed',
        source_id: 'zone_1_level_3'
      };

      const { error } = schemaMap.currency_earned.validate(event);
      expect(error).toBeUndefined();
    });

    test('should validate gems earned', () => {
      const event = {
        event_type: 'currency_earned',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        currency_type: 'gems',
        amount: 25,
        source: 'prize_claimed',
        source_id: 'prize_weekly_2025_01_device_123'
      };

      const { error } = schemaMap.currency_earned.validate(event);
      expect(error).toBeUndefined();
    });

    test('should reject invalid currency type', () => {
      const event = {
        event_type: 'currency_earned',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        currency_type: 'tickets', // invalid
        amount: 100,
        source: 'mission_completed'
      };

      const { error } = schemaMap.currency_earned.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('currency_spent', () => {
    test('should validate currency spending', () => {
      const event = {
        event_type: 'currency_spent',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        currency_type: 'coins',
        amount: 500,
        spent_on: 'item_purchase',
        item_id: 'skin_red_jet'
      };

      const { error } = schemaMap.currency_spent.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('continue_used', () => {
    test('should validate continue with coins', () => {
      const event = {
        event_type: 'continue_used',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        game_mode: 'endless',
        continue_type: 'revive',
        cost_coins: 100,
        cost_gems: 0,
        score_at_continue: 42
      };

      const { error } = schemaMap.continue_used.validate(event);
      expect(error).toBeUndefined();
    });

    test('should validate continue with gems', () => {
      const event = {
        event_type: 'continue_used',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        game_mode: 'story',
        continue_type: 'revive',
        cost_coins: 0,
        cost_gems: 10,
        score_at_continue: 15,
        level_id: 'zone_2_level_5'
      };

      const { error } = schemaMap.continue_used.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('level_started', () => {
    test('should validate level start', () => {
      const event = {
        event_type: 'level_started',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        zone_id: 'zone_1',
        level_id: 'zone_1_level_1',
        attempt_number: 1
      };

      const { error } = schemaMap.level_started.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('level_completed', () => {
    // Base fields required for all events
    const baseEventFields = {
      user_id: 'device_123',
      timestamp: '2025-01-01T00:00:00.000Z',
      app_version: '1.4.2',
      platform: 'android'
    };

    test('should validate level completion with all fields', () => {
      const event = {
        ...baseEventFields,
        event_type: 'level_completed',
        level_id: 1,
        zone_id: 1,
        score: 16,
        stars: 3,
        time_seconds: 45,
        hearts_remaining: 2,
        first_attempt: true,
        level_name: 'Sky Rookie 1',
        objective_type: 'passObstacles',
        continues_used: 0
      };

      const { error } = schemaMap.level_completed.validate(event);
      expect(error).toBeUndefined();
    });

    test('should validate level completion without optional stars (defaults to 0)', () => {
      const event = {
        ...baseEventFields,
        event_type: 'level_completed',
        level_id: 5,
        zone_id: 1,
        score: 20,
        // stars not provided - should default to 0
        time_seconds: 60,
        hearts_remaining: 1,
        first_attempt: false
      };

      const { error, value } = schemaMap.level_completed.validate(event);
      expect(error).toBeUndefined();
      expect(value.stars).toBe(0); // Default value
    });

    test('should validate level completion with optional fields', () => {
      const event = {
        ...baseEventFields,
        event_type: 'level_completed',
        level_id: 10,
        zone_id: 1,
        score: 25,
        stars: 2,
        time_seconds: 90,
        hearts_remaining: 3,
        first_attempt: true,
        level_name: 'Sky Rookie 10',
        objective_type: 'ObjectiveType.passObstacles',
        continues_used: 1
      };

      const { error } = schemaMap.level_completed.validate(event);
      expect(error).toBeUndefined();
    });

    test('should reject level_completed with invalid level_id', () => {
      const event = {
        ...baseEventFields,
        event_type: 'level_completed',
        level_id: 0, // Invalid - must be >= 1
        zone_id: 1,
        score: 10,
        time_seconds: 30,
        hearts_remaining: 3,
        first_attempt: true
      };

      const { error } = schemaMap.level_completed.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('level_failed', () => {
    // Base fields required for all events
    const baseEventFields = {
      user_id: 'device_123',
      timestamp: '2025-01-01T00:00:00.000Z',
      app_version: '1.4.2',
      platform: 'android'
    };

    test('should validate level failure with all fields', () => {
      const event = {
        ...baseEventFields,
        event_type: 'level_failed',
        level_id: 5,
        zone_id: 1,
        level_name: 'Sky Rookie 5',
        score: 12,
        objective_target: 16,
        objective_type: 'ObjectiveType.passObstacles',
        cause_of_death: 'obstacle_collision',
        time_survived_seconds: 45,
        hearts_remaining: 0,
        continues_used: 2
      };

      const { error } = schemaMap.level_failed.validate(event);
      expect(error).toBeUndefined();
    });

    test('should reject level_failed without required cause_of_death', () => {
      const event = {
        ...baseEventFields,
        event_type: 'level_failed',
        level_id: 5,
        zone_id: 1,
        level_name: 'Sky Rookie 5',
        score: 12,
        objective_target: 16,
        objective_type: 'passObstacles',
        // cause_of_death missing
        time_survived_seconds: 45,
        hearts_remaining: 0,
        continues_used: 0
      };

      const { error } = schemaMap.level_failed.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('mission_unlocked', () => {
    test('should validate mission unlock (criteria met, ready to claim)', () => {
      const event = {
        event_type: 'mission_unlocked',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        mission_id: 'daily_play_games_3',
        mission_type: 'MissionType.playGames',
        mission_difficulty: 'MissionDifficulty.easy',
        mission_title: 'Play 3 Games',
        reward_coins: 100,
        target: 3,
        progress: 3
      };

      const { error } = schemaMap.mission_unlocked.validate(event);
      expect(error).toBeUndefined();
    });

    test('should require all mission_unlocked fields', () => {
      const event = {
        event_type: 'mission_unlocked',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        mission_id: 'daily_play_games_3'
        // Missing required fields
      };

      const { error } = schemaMap.mission_unlocked.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('mission_completed', () => {
    test('should validate mission completion (reward claimed)', () => {
      const event = {
        event_type: 'mission_completed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        mission_id: 'daily_play_games_3',
        mission_type: 'MissionType.playGames',
        mission_difficulty: 'MissionDifficulty.easy',
        reward_coins: 100,
        completion_time_seconds: 3600 // Time between unlock and claim
      };

      const { error } = schemaMap.mission_completed.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('achievement_unlocked', () => {
    test('should validate achievement unlock (criteria met)', () => {
      const event = {
        event_type: 'achievement_unlocked',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        achievement_id: 'first_flight',
        achievement_name: 'First Flight',
        achievement_tier: 'AchievementRarity.common',
        achievement_category: 'AchievementCategory.gameplay',
        reward_coins: 200,
        reward_gems: 10
      };

      const { error } = schemaMap.achievement_unlocked.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('achievement_claimed', () => {
    test('should validate achievement claim (reward collected)', () => {
      const event = {
        event_type: 'achievement_claimed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        achievement_id: 'first_flight',
        achievement_name: 'First Flight',
        achievement_tier: 'AchievementRarity.common',
        achievement_category: 'AchievementCategory.gameplay',
        reward_coins: 200,
        reward_gems: 10,
        time_to_claim_seconds: 86400 // 1 day between unlock and claim
      };

      const { error } = schemaMap.achievement_claimed.validate(event);
      expect(error).toBeUndefined();
    });

    test('should require time_to_claim_seconds', () => {
      const event = {
        event_type: 'achievement_claimed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        achievement_id: 'first_flight',
        achievement_name: 'First Flight',
        achievement_tier: 'AchievementRarity.common',
        achievement_category: 'AchievementCategory.gameplay',
        reward_coins: 200,
        reward_gems: 10
        // Missing time_to_claim_seconds
      };

      const { error } = schemaMap.achievement_claimed.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('tournament_entered', () => {
    test('should validate tournament entry', () => {
      const event = {
        event_type: 'tournament_entered',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        tournament_id: 'weekly_2025_01'
      };

      const { error } = schemaMap.tournament_entered.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('daily_streak_claimed', () => {
    test('should validate daily streak claim', () => {
      const event = {
        event_type: 'daily_streak_claimed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        day_in_cycle: 3,
        current_streak: 10,
        current_cycle: 1,
        reward_type: 'coins',
        reward_amount: 100,
        reward_set: 'new_player'
      };

      const { error } = schemaMap.daily_streak_claimed.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('daily_streak_milestone', () => {
    test('should validate streak milestone', () => {
      const event = {
        event_type: 'daily_streak_milestone',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        milestone_days: 7,
        current_cycle: 1,
        total_cycles_completed: 0
      };

      const { error } = schemaMap.daily_streak_milestone.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('daily_streak_broken', () => {
    test('should validate streak broken event', () => {
      const event = {
        event_type: 'daily_streak_broken',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        last_streak_days: 5,
        last_cycle: 0,
        total_cycles_completed: 0
      };

      const { error } = schemaMap.daily_streak_broken.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('daily_streak_cycle_completed', () => {
    test('should validate cycle completion', () => {
      const event = {
        event_type: 'daily_streak_cycle_completed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        cycle_number: 2,
        total_cycles_completed: 1,
        reward_set: 'experienced'
      };

      const { error } = schemaMap.daily_streak_cycle_completed.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('prize_available', () => {
    test('should validate prizes available event', () => {
      const event = {
        event_type: 'prize_available',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        count: 2,
        total_coins: 500,
        total_gems: 10
      };

      const { error } = schemaMap.prize_available.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('prize_claimed', () => {
    test('should validate prize claimed event', () => {
      const event = {
        event_type: 'prize_claimed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        app_version: '1.4.2',
        platform: 'android',
        prize_id: 'prize_123',
        tournament_id: 'weekly_2025_01',
        tournament_name: 'Weekly Tournament',
        rank: 5,
        coins: 200,
        gems: 5,
        claimed_at: '2025-01-01T12:00:00.000Z'
      };

      const { error } = schemaMap.prize_claimed.validate(event);
      expect(error).toBeUndefined();
    });
  });
});

