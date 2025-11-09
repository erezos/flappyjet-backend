/**
 * Unit Tests for EventProcessor
 * Tests event validation, storage, and error handling
 */

const EventProcessor = require('../../services/event-processor');

describe('EventProcessor', () => {
  let mockDb;
  let processor;

  beforeEach(() => {
    // Mock database
    mockDb = {
      query: jest.fn()
    };

    processor = new EventProcessor(mockDb);
  });

  describe('processEvent', () => {
    test('should process valid app_installed event', async () => {
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

      mockDb.query.mockResolvedValue({ rows: [{ id: 'event_123' }] });

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.event_type).toBe('app_installed');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO events'),
        expect.arrayContaining(['app_installed', 'device_123', expect.any(Object)])
      );
    });

    test('should process valid game_ended event', async () => {
      const event = {
        event_type: 'game_ended',
        user_id: 'device_456',
        timestamp: '2025-01-01T00:10:00.000Z',
        game_mode: 'endless',
        score: 99,
        duration_seconds: 300,
        obstacles_passed: 50,
        result: 'crashed'
      };

      mockDb.query.mockResolvedValue({ rows: [{ id: 'event_456' }] });

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.event_type).toBe('game_ended');
      expect(mockDb.query).toHaveBeenCalled();
    });

    test('should reject event with invalid schema', async () => {
      const event = {
        event_type: 'app_installed',
        // Missing required user_id
        timestamp: '2025-01-01T00:00:00.000Z'
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    test('should reject unknown event type', async () => {
      const event = {
        event_type: 'unknown_event',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z'
      };

      const result = await processor.processEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown event type');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    test('should handle database errors gracefully', async () => {
      const event = {
        event_type: 'app_launched',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z'
      };

      mockDb.query.mockRejectedValue(new Error('Database connection lost'));

      const result = await processor.processEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection lost');
    });

    test('should process currency_earned event', async () => {
      const event = {
        event_type: 'currency_earned',
        user_id: 'device_789',
        timestamp: '2025-01-01T00:00:00.000Z',
        currency_type: 'coins',
        amount: 500,
        source: 'level_completed',
        source_id: 'zone_1_level_1'
      };

      mockDb.query.mockResolvedValue({ rows: [{ id: 'event_789' }] });

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.event_type).toBe('currency_earned');
    });

    test('should process continue_used event', async () => {
      const event = {
        event_type: 'continue_used',
        user_id: 'device_999',
        timestamp: '2025-01-01T00:00:00.000Z',
        game_mode: 'endless',
        continue_type: 'revive',
        cost_coins: 100,
        cost_gems: 0,
        score_at_continue: 42
      };

      mockDb.query.mockResolvedValue({ rows: [{ id: 'event_999' }] });

      const result = await processor.processEvent(event);

      expect(result.success).toBe(true);
      expect(result.event_type).toBe('continue_used');
    });

    test('should process batch of events', async () => {
      const events = [
        {
          event_type: 'app_launched',
          user_id: 'device_123',
          timestamp: '2025-01-01T00:00:00.000Z'
        },
        {
          event_type: 'game_started',
          user_id: 'device_123',
          timestamp: '2025-01-01T00:01:00.000Z',
          game_mode: 'endless'
        },
        {
          event_type: 'game_ended',
          user_id: 'device_123',
          timestamp: '2025-01-01T00:05:00.000Z',
          game_mode: 'endless',
          score: 25,
          duration_seconds: 240
        }
      ];

      mockDb.query.mockResolvedValue({ rows: [{ id: 'event_batch' }] });

      const results = await Promise.all(
        events.map(event => processor.processEvent(event))
      );

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });
  });

  describe('getStats', () => {
    test('should return processor statistics', () => {
      const stats = processor.getStats();

      expect(stats).toHaveProperty('total_processed');
      expect(stats).toHaveProperty('total_errors');
      expect(stats).toHaveProperty('by_type');
      expect(stats.total_processed).toBe(0);
      expect(stats.total_errors).toBe(0);
    });

    test('should track processed events', async () => {
      const event = {
        event_type: 'app_launched',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z'
      };

      mockDb.query.mockResolvedValue({ rows: [{ id: 'event_123' }] });

      await processor.processEvent(event);

      const stats = processor.getStats();
      expect(stats.total_processed).toBe(1);
      expect(stats.by_type.app_launched).toBe(1);
    });

    test('should track errors', async () => {
      const event = {
        event_type: 'unknown_event',
        user_id: 'device_123',
        timestamp: '2025-01-01T00:00:00.000Z'
      };

      await processor.processEvent(event);

      const stats = processor.getStats();
      expect(stats.total_errors).toBe(1);
    });
  });
});

