/**
 * Unit Tests for LeaderboardAggregator
 * Tests leaderboard update logic from game_ended events
 */

const LeaderboardAggregator = require('../../services/leaderboard-aggregator');

describe('LeaderboardAggregator', () => {
  let mockDb;
  let mockCache;
  let aggregator;

  beforeEach(() => {
    mockDb = {
      query: jest.fn()
    };

    mockCache = {
      delete: jest.fn().mockResolvedValue(true)
    };

    aggregator = new LeaderboardAggregator(mockDb, mockCache);
  });

  describe('updateGlobalLeaderboard', () => {
    test('should process game_ended events and update leaderboard', async () => {
      // Mock unprocessed events
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'event_1',
              user_id: 'device_123',
              payload: {
                score: 99,
                game_mode: 'endless',
                duration_seconds: 300,
                timestamp: '2025-01-01T00:00:00.000Z'
              }
            },
            {
              id: 'event_2',
              user_id: 'device_456',
              payload: {
                score: 150,
                game_mode: 'endless',
                duration_seconds: 400,
                timestamp: '2025-01-01T00:05:00.000Z'
              }
            }
          ]
        })
        // Mock UPSERT for each user
        .mockResolvedValue({ rows: [] });

      const result = await aggregator.updateGlobalLeaderboard();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
      expect(mockDb.query).toHaveBeenCalled();
      expect(mockCache.delete).toHaveBeenCalledWith('leaderboard:global:top15');
    });

    test('should handle empty event queue', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await aggregator.updateGlobalLeaderboard();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(0);
    });

    test('should only update if score is higher', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'event_3',
              user_id: 'device_789',
              payload: {
                score: 50,
                game_mode: 'endless',
                duration_seconds: 200,
                timestamp: '2025-01-01T00:00:00.000Z'
              }
            }
          ]
        })
        .mockResolvedValue({ rows: [] });

      await aggregator.updateGlobalLeaderboard();

      // Verify UPSERT was called with GREATEST(high_score, new_score)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('GREATEST(COALESCE(high_score, 0), $3)'),
        expect.any(Array)
      );
    });

    test('should handle database errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database timeout'));

      const result = await aggregator.updateGlobalLeaderboard();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database timeout');
    });
  });

  describe('updateTournamentLeaderboard', () => {
    test('should process tournament game_ended events', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'event_t1',
              user_id: 'device_111',
              payload: {
                score: 200,
                game_mode: 'tournament',
                tournament_id: 'weekly_2025_01',
                duration_seconds: 500,
                timestamp: '2025-01-01T00:00:00.000Z'
              }
            }
          ]
        })
        .mockResolvedValue({ rows: [] });

      const result = await aggregator.updateTournamentLeaderboard();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(1);
      expect(mockCache.delete).toHaveBeenCalledWith(
        expect.stringContaining('tournament:weekly_2025_01:leaderboard')
      );
    });

    test('should only process tournament mode events', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'event_e1',
              user_id: 'device_222',
              payload: {
                score: 100,
                game_mode: 'endless', // Not tournament
                duration_seconds: 300,
                timestamp: '2025-01-01T00:00:00.000Z'
              }
            }
          ]
        })
        .mockResolvedValue({ rows: [] });

      const result = await aggregator.updateTournamentLeaderboard();

      // Should still mark as processed but not update leaderboard
      expect(result.success).toBe(true);
    });

    test('should handle missing tournament_id', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'event_t2',
              user_id: 'device_333',
              payload: {
                score: 150,
                game_mode: 'tournament',
                // Missing tournament_id
                duration_seconds: 400,
                timestamp: '2025-01-01T00:00:00.000Z'
              }
            }
          ]
        })
        .mockResolvedValue({ rows: [] });

      const result = await aggregator.updateTournamentLeaderboard();

      expect(result.success).toBe(true);
      // Should still process but skip leaderboard update
    });
  });

  describe('getStats', () => {
    test('should return aggregator statistics', () => {
      const stats = aggregator.getStats();

      expect(stats).toHaveProperty('global_updates');
      expect(stats).toHaveProperty('tournament_updates');
      expect(stats).toHaveProperty('total_events_processed');
      expect(stats).toHaveProperty('last_global_update');
      expect(stats).toHaveProperty('last_tournament_update');
    });

    test('should track update counts', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'event_1',
              user_id: 'device_123',
              payload: { score: 99, game_mode: 'endless', duration_seconds: 300 }
            }
          ]
        })
        .mockResolvedValue({ rows: [] });

      await aggregator.updateGlobalLeaderboard();

      const stats = aggregator.getStats();
      expect(stats.global_updates).toBe(1);
      expect(stats.total_events_processed).toBe(1);
    });
  });
});

