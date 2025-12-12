/**
 * 🧪 Tests for Conversion Events Schema Validation
 * 
 * Verifies that:
 * - All 8 conversion event types are accepted by the schema
 * - Event data is properly validated
 * - Schema handles both Firebase and Railway formats
 */

const { validateEvent, conversionEventSchema } = require('../../services/event-schemas');

describe('Conversion Events Schema', () => {
  // Base event fields required for all events
  const baseEvent = {
    user_id: 'user_test_123',
    session_id: 'session_abc',
    app_version: '2.3.0',
    platform: 'android',
  };

  describe('Schema Recognition', () => {
    const conversionEventTypes = [
      'conversion_games_played_3',
      'conversion_games_played_5',
      'conversion_games_played_10',
      'conversion_sessions_3',
      'conversion_sessions_6',
      'conversion_level_completed_3',
      'conversion_level_completed_5',
      'conversion_level_completed_10',
    ];

    test.each(conversionEventTypes)('recognizes %s as valid conversion event', (eventType) => {
      const event = {
        ...baseEvent,
        event_type: eventType,
        timestamp: Date.now(),
        milestone_type: 'gamesPlayed',
        threshold: 3,
        total_games_played: 5,
        session_count: 2,
        highest_level: 3,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('rejects non-conversion events with conversion_ prefix typo', () => {
      const event = {
        ...baseEvent,
        event_type: 'converion_games_played_3', // Typo
        timestamp: Date.now(),
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });
  });

  describe('Timestamp Flexibility', () => {
    test('accepts numeric timestamp (milliseconds)', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_games_played_3',
        timestamp: 1733680000000, // Numeric timestamp
        milestone_type: 'gamesPlayed',
        threshold: 3,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('accepts ISO string timestamp', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_games_played_5',
        timestamp: '2024-12-08T12:00:00.000Z', // ISO string
        milestone_type: 'gamesPlayed',
        threshold: 5,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });
  });

  describe('Optional Fields', () => {
    test('accepts event with all optional fields', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_level_completed_10',
        timestamp: Date.now(),
        milestone_type: 'levelCompleted',
        milestone_value: 10,
        milestone_threshold: 10,
        total_games_played: 50,
        session_count: 15,
        highest_level: 10,
        high_score: 1500,
        total_score: 25000,
        coins_earned: 5000,
        gems_earned: 100,
        current_level: 10,
        highest_level_unlocked: 10,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('accepts event with minimal fields', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_sessions_6',
        timestamp: Date.now(),
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });
  });

  describe('Games Played Milestones', () => {
    test('validates conversion_games_played_3', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_games_played_3',
        timestamp: Date.now(),
        milestone_type: 'gamesPlayed',
        threshold: 3,
        total_games_played: 3,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('validates conversion_games_played_5', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_games_played_5',
        timestamp: Date.now(),
        milestone_type: 'gamesPlayed',
        threshold: 5,
        total_games_played: 7,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('validates conversion_games_played_10', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_games_played_10',
        timestamp: Date.now(),
        milestone_type: 'gamesPlayed',
        threshold: 10,
        total_games_played: 15,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });
  });

  describe('Session Milestones', () => {
    test('validates conversion_sessions_3', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_sessions_3',
        timestamp: Date.now(),
        milestone_type: 'sessions',
        threshold: 3,
        session_count: 3,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('validates conversion_sessions_6', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_sessions_6',
        timestamp: Date.now(),
        milestone_type: 'sessions',
        threshold: 6,
        session_count: 8,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });
  });

  describe('Level Completed Milestones', () => {
    test('validates conversion_level_completed_3', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_level_completed_3',
        timestamp: Date.now(),
        milestone_type: 'levelCompleted',
        threshold: 3,
        highest_level: 3,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('validates conversion_level_completed_5', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_level_completed_5',
        timestamp: Date.now(),
        milestone_type: 'levelCompleted',
        threshold: 5,
        highest_level: 5,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    test('validates conversion_level_completed_10', () => {
      const event = {
        ...baseEvent,
        event_type: 'conversion_level_completed_10',
        timestamp: Date.now(),
        milestone_type: 'levelCompleted',
        threshold: 10,
        highest_level: 12,
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });
  });

  describe('Dynamic Pattern Matching', () => {
    test('schema pattern matches conversion_ prefix', () => {
      // Any event starting with conversion_ should be caught
      const customConversion = {
        ...baseEvent,
        event_type: 'conversion_custom_milestone',
        timestamp: Date.now(),
      };

      const result = validateEvent(customConversion);
      // Should be valid because it matches conversion_ pattern
      expect(result.valid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('rejects event without required base fields', () => {
      const event = {
        event_type: 'conversion_games_played_3',
        timestamp: Date.now(),
        // Missing user_id, session_id, app_version, platform
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('provides meaningful error messages', () => {
      const event = {
        event_type: 'conversion_games_played_3',
        timestamp: Date.now(),
        // Missing required fields
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('user_id') || e.includes('required'))).toBe(true);
    });
  });
});

