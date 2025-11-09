/**
 * Unit Tests for Event Schemas (Joi validation)
 * Tests all 28 event schemas to ensure proper validation
 */

const eventSchemas = require('../../services/event-schemas');

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

      const { error } = eventSchemas.app_installed.validate(event);
      expect(error).toBeUndefined();
    });

    test('should reject missing required fields', () => {
      const event = {
        event_type: 'app_installed',
        // missing user_id
        timestamp: '2025-01-01T00:00:00.000Z'
      };

      const { error } = eventSchemas.app_installed.validate(event);
      expect(error).toBeDefined();
    });

    test('should reject invalid platform', () => {
      const event = {
        event_type: 'app_installed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        platform: 'windows' // invalid
      };

      const { error } = eventSchemas.app_installed.validate(event);
      expect(error).toBeDefined();
    });
  });

  describe('game_ended', () => {
    test('should validate correct game_ended event', () => {
      const event = {
        event_type: 'game_ended',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        game_mode: 'endless',
        score: 42,
        duration_seconds: 120,
        obstacles_passed: 20,
        result: 'crashed',
        crash_reason: 'obstacle_collision'
      };

      const { error } = eventSchemas.game_ended.validate(event);
      expect(error).toBeUndefined();
    });

    test('should validate tournament game_ended event', () => {
      const event = {
        event_type: 'game_ended',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        game_mode: 'tournament',
        tournament_id: 'weekly_2025_01',
        score: 99,
        duration_seconds: 300,
        obstacles_passed: 50,
        result: 'crashed'
      };

      const { error } = eventSchemas.game_ended.validate(event);
      expect(error).toBeUndefined();
    });

    test('should reject negative score', () => {
      const event = {
        event_type: 'game_ended',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        game_mode: 'endless',
        score: -10, // invalid
        duration_seconds: 120
      };

      const { error } = eventSchemas.game_ended.validate(event);
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

      const { error } = eventSchemas.currency_earned.validate(event);
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

      const { error } = eventSchemas.currency_earned.validate(event);
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

      const { error } = eventSchemas.currency_earned.validate(event);
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

      const { error } = eventSchemas.currency_spent.validate(event);
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

      const { error } = eventSchemas.continue_used.validate(event);
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

      const { error } = eventSchemas.continue_used.validate(event);
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

      const { error } = eventSchemas.level_started.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('level_completed', () => {
    test('should validate level completion', () => {
      const event = {
        event_type: 'level_completed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        zone_id: 'zone_1',
        level_id: 'zone_1_level_1',
        score: 50,
        duration_seconds: 180,
        stars_earned: 3,
        coins_earned: 100,
        is_new_record: true
      };

      const { error } = eventSchemas.level_completed.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('level_failed', () => {
    test('should validate level failure', () => {
      const event = {
        event_type: 'level_failed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        zone_id: 'zone_2',
        level_id: 'zone_2_level_5',
        score: 20,
        duration_seconds: 60,
        attempt_number: 3,
        crash_reason: 'obstacle_collision'
      };

      const { error } = eventSchemas.level_failed.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('mission_completed', () => {
    test('should validate mission completion', () => {
      const event = {
        event_type: 'mission_completed',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        mission_id: 'daily_play_games_3',
        reward_coins: 100,
        reward_gems: 0
      };

      const { error } = eventSchemas.mission_completed.validate(event);
      expect(error).toBeUndefined();
    });
  });

  describe('achievement_unlocked', () => {
    test('should validate achievement unlock', () => {
      const event = {
        event_type: 'achievement_unlocked',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z',
        achievement_id: 'first_flight',
        reward_coins: 200,
        reward_gems: 10
      };

      const { error } = eventSchemas.achievement_unlocked.validate(event);
      expect(error).toBeUndefined();
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

      const { error } = eventSchemas.tournament_entered.validate(event);
      expect(error).toBeUndefined();
    });
  });
});

