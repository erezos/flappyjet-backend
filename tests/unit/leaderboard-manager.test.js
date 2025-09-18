/**
 * Leaderboard Manager Unit Tests
 * Tests for the new global leaderboard system
 */

const LeaderboardManager = require('../../services/leaderboard-manager');

// Mock dependencies
const mockDb = {
  query: jest.fn(),
  connect: jest.fn(),
  release: jest.fn()
};

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn()
};

describe('LeaderboardManager', () => {
  let leaderboardManager;

  beforeEach(() => {
    jest.clearAllMocks();
    leaderboardManager = new LeaderboardManager({
      db: mockDb,
      cacheManager: mockCacheManager
    });
  });

  describe('Global Leaderboard', () => {
    test('should get global leaderboard with top players', async () => {
      const mockLeaderboardData = [
        {
          player_id: 'player1',
          player_name: 'TestPlayer1',
          best_score: 1000,
          total_games: 50,
          jet_skin: 'jets/green_lightning.png',
          theme: 'sky',
          updated_at: new Date(),
          rank: 1
        },
        {
          player_id: 'player2',
          player_name: 'TestPlayer2',
          best_score: 800,
          total_games: 30,
          jet_skin: 'jets/red_rocket.png',
          theme: 'space',
          updated_at: new Date(),
          rank: 2
        }
      ];

      mockCacheManager.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: mockLeaderboardData });
      mockCacheManager.set.mockResolvedValue(true);

      const result = await leaderboardManager.getGlobalLeaderboard({
        limit: 15,
        offset: 0
      });

      expect(result.success).toBe(true);
      expect(result.leaderboard).toHaveLength(2);
      expect(result.leaderboard[0].playerName).toBe('TestPlayer1');
      expect(result.leaderboard[0].score).toBe(1000);
      expect(result.leaderboard[0].rank).toBe(1);
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [15, 0]
      );
      expect(mockCacheManager.set).toHaveBeenCalled();
    });

    test('should return cached leaderboard when available', async () => {
      const cachedData = [
        {
          playerId: 'player1',
          playerName: 'CachedPlayer',
          score: 1500,
          rank: 1
        }
      ];

      mockCacheManager.get.mockResolvedValue(cachedData);

      const result = await leaderboardManager.getGlobalLeaderboard({
        limit: 15,
        offset: 0
      });

      expect(result.success).toBe(true);
      expect(result.leaderboard).toEqual(cachedData);
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    test('should handle database errors gracefully', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      const result = await leaderboardManager.getGlobalLeaderboard({
        limit: 15,
        offset: 0
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get global leaderboard');
    });
  });

  describe('User Position', () => {
    test('should get user position in global leaderboard', async () => {
      const mockUserData = {
        player_id: 'user123',
        player_name: 'TestUser',
        best_score: 750,
        jet_skin: 'jets/blue_bolt.png',
        theme: 'ocean',
        updated_at: new Date(),
        rank: 5
      };

      mockCacheManager.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: [mockUserData] });
      mockCacheManager.set.mockResolvedValue(true);

      const result = await leaderboardManager._getUserPosition('user123');

      expect(result).toBeTruthy();
      expect(result.playerId).toBe('user123');
      expect(result.playerName).toBe('TestUser');
      expect(result.rank).toBe(5);
      expect(result.score).toBe(750);
    });

    test('should return null for non-existent user', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await leaderboardManager._getUserPosition('nonexistent');

      expect(result).toBeNull();
    });

    test('should return cached user position when available', async () => {
      const cachedPosition = {
        playerId: 'user123',
        playerName: 'CachedUser',
        rank: 10,
        score: 500
      };

      mockCacheManager.get.mockResolvedValue(cachedPosition);

      const result = await leaderboardManager._getUserPosition('user123');

      expect(result).toEqual(cachedPosition);
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  describe('Personal Scores', () => {
    test('should get player personal scores', async () => {
      const mockPersonalScores = [
        {
          score: 1000,
          survival_time: 120,
          jet_skin: 'jets/green_lightning.png',
          theme: 'sky',
          game_data: {},
          created_at: new Date()
        },
        {
          score: 800,
          survival_time: 90,
          jet_skin: 'jets/red_rocket.png',
          theme: 'space',
          game_data: {},
          created_at: new Date()
        }
      ];

      mockCacheManager.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: mockPersonalScores });
      mockCacheManager.set.mockResolvedValue(true);

      const result = await leaderboardManager.getPlayerPersonalScores('player123', 10);

      expect(result.success).toBe(true);
      expect(result.scores).toHaveLength(2);
      expect(result.scores[0].rank).toBe(1);
      expect(result.scores[0].score).toBe(1000);
      expect(result.scores[1].rank).toBe(2);
      expect(result.scores[1].score).toBe(800);
    });

    test('should handle empty personal scores', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await leaderboardManager.getPlayerPersonalScores('player123', 10);

      expect(result.success).toBe(true);
      expect(result.scores).toHaveLength(0);
    });
  });

  describe('Score Submission', () => {
    test('should submit new score successfully', async () => {
      const mockSessionResult = { rows: [{ id: 'session123' }] };
      const mockPlayerResult = { rows: [{ best_score: 1000, is_new_best: true }] };

      mockDb.query
        .mockResolvedValueOnce(mockSessionResult) // Insert game session
        .mockResolvedValueOnce(mockPlayerResult); // Upsert player

      mockCacheManager.delete.mockResolvedValue(true);

      const result = await leaderboardManager.submitScore({
        playerId: 'player123',
        playerName: 'TestPlayer',
        score: 1000,
        jetSkin: 'jets/green_lightning.png',
        theme: 'sky'
      });

      expect(result.success).toBe(true);
      expect(result.newBest).toBe(true);
      expect(result.score).toBe(1000);
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    test('should validate input parameters', async () => {
      const result = await leaderboardManager.submitScore({
        playerId: '',
        playerName: 'TestPlayer',
        score: 1000
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input parameters');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    test('should handle negative scores', async () => {
      const result = await leaderboardManager.submitScore({
        playerId: 'player123',
        playerName: 'TestPlayer',
        score: -100
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input parameters');
    });
  });

  describe('Nickname Updates', () => {
    test('should update player nickname successfully', async () => {
      const mockPlayerResult = { rows: [{ id: 'player123' }] };
      const mockSessionsResult = { rows: [] };

      mockDb.query
        .mockResolvedValueOnce(mockPlayerResult) // Update player
        .mockResolvedValueOnce(mockSessionsResult); // Update sessions

      mockCacheManager.delete.mockResolvedValue(true);

      const result = await leaderboardManager.updatePlayerNickname('player123', 'NewNickname');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Nickname updated successfully');
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    test('should validate nickname update parameters', async () => {
      const result = await leaderboardManager.updatePlayerNickname('', 'NewNickname');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player ID and nickname required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    test('should validate empty nickname', async () => {
      const result = await leaderboardManager.updatePlayerNickname('player123', '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player ID and nickname required');
    });
  });

  describe('Cache Management', () => {
    test('should clear relevant caches after score submission', async () => {
      const mockSessionResult = { rows: [{ id: 'session123' }] };
      const mockPlayerResult = { rows: [{ best_score: 1000, is_new_best: true }] };

      mockDb.query
        .mockResolvedValueOnce(mockSessionResult)
        .mockResolvedValueOnce(mockPlayerResult);

      mockCacheManager.delete.mockResolvedValue(true);

      await leaderboardManager.submitScore({
        playerId: 'player123',
        playerName: 'TestPlayer',
        score: 1000
      });

      expect(mockCacheManager.delete).toHaveBeenCalledWith(
        expect.stringContaining('leaderboard:global')
      );
      expect(mockCacheManager.delete).toHaveBeenCalledWith(
        expect.stringContaining('leaderboard:player:player123')
      );
      expect(mockCacheManager.delete).toHaveBeenCalledWith(
        expect.stringContaining('leaderboard:rank:player123')
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockDb.query.mockRejectedValue(new Error('Connection timeout'));

      const result = await leaderboardManager.getGlobalLeaderboard({ limit: 15 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get global leaderboard');
    });

    test('should handle cache errors gracefully', async () => {
      mockCacheManager.get.mockRejectedValue(new Error('Cache unavailable'));
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await leaderboardManager.getGlobalLeaderboard({ limit: 15 });

      expect(result.success).toBe(true); // Should still work without cache
      expect(mockDb.query).toHaveBeenCalled();
    });
  });
});
