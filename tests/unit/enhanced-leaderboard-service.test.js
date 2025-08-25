/**
 * 🧪 Enhanced Leaderboard Service Unit Tests - TDD Style
 * Focused unit tests for the leaderboard service without server dependencies
 */

const { EnhancedLeaderboardService } = require('../../services/enhanced-leaderboard-service');
const { CacheManager } = require('../../services/cache-manager');
const { AntiCheatEngine } = require('../../services/anti-cheat-engine');

describe('🏆 Enhanced Leaderboard Service - Unit Tests', () => {
  let leaderboardService;
  let mockDb;
  let mockRedis;
  let mockCache;
  let mockAntiCheat;

  beforeEach(() => {
    // Create mock database
    mockDb = {
      query: jest.fn()
    };

    // Create mock Redis
    mockRedis = global.testHelpers.createMockRedis();

    // Create mock cache manager
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      deletePattern: jest.fn()
    };

    // Create mock anti-cheat engine
    mockAntiCheat = {
      validateScore: jest.fn()
    };

    // Create service instance
    leaderboardService = new EnhancedLeaderboardService(mockDb, mockRedis);
    leaderboardService.cache = mockCache;
    leaderboardService.antiCheat = mockAntiCheat;
  });

  describe('📤 Score Submission', () => {
    test('should submit valid score successfully', async () => {
      // Arrange
      const playerId = 'player-123';
      const scoreData = {
        score: 150,
        survivalTime: 45000,
        skinUsed: 'sky_jet',
        coinsEarned: 75,
        gemsEarned: 0,
        gameDuration: 45000
      };

      // Mock anti-cheat validation
      mockAntiCheat.validateScore.mockResolvedValue({
        isValid: true,
        confidence: 1.0
      });

      // Mock database queries
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // Recent scores query
        .mockResolvedValueOnce({ rows: [] }) // Current best query
        .mockResolvedValueOnce({ rows: [{ id: 'score-123' }] }) // Insert score
        .mockResolvedValueOnce({ rows: [{ rank: 5 }] }); // Calculate rank

      // Act
      const result = await leaderboardService.submitScore(playerId, scoreData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.scoreId).toBe('score-123');
      expect(result.rank).toBe(5);
      expect(result.coinsEarned).toBe(75);
      expect(mockAntiCheat.validateScore).toHaveBeenCalledWith(
        playerId,
        scoreData,
        []
      );
      expect(mockDb.query).toHaveBeenCalledTimes(4);
    });

    test('should reject score due to anti-cheat violation', async () => {
      // Arrange
      const playerId = 'player-123';
      const scoreData = {
        score: 1000000, // Impossibly high score
        survivalTime: 1000,
        skinUsed: 'sky_jet'
      };

      // Mock recent scores query (needed for anti-cheat)
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      // Mock anti-cheat rejection
      mockAntiCheat.validateScore.mockResolvedValue({
        isValid: false,
        reason: 'Score exceeds maximum allowed value'
      });

      // Act
      const result = await leaderboardService.submitScore(playerId, scoreData);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Anti-cheat violation');
      expect(mockDb.query).toHaveBeenCalledTimes(1); // Only recent scores query, no insert
    });

    test('should detect personal best correctly', async () => {
      // Arrange
      const playerId = 'player-123';
      const scoreData = {
        score: 200,
        survivalTime: 60000,
        skinUsed: 'sky_jet'
      };

      // Mock anti-cheat validation
      mockAntiCheat.validateScore.mockResolvedValue({
        isValid: true,
        confidence: 1.0
      });

      // Mock database queries
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // Recent scores
        .mockResolvedValueOnce({ rows: [{ score: 150 }] }) // Current best (lower)
        .mockResolvedValueOnce({ rows: [{ id: 'score-456' }] }) // Insert
        .mockResolvedValueOnce({ rows: [{ rank: 3 }] }); // Rank

      // Act
      const result = await leaderboardService.submitScore(playerId, scoreData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.isPersonalBest).toBe(true);
    });

    test('should handle database errors gracefully', async () => {
      // Arrange
      const playerId = 'player-123';
      const scoreData = {
        score: 100,
        survivalTime: 30000,
        skinUsed: 'sky_jet'
      };

      // Mock database error
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await leaderboardService.submitScore(playerId, scoreData);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
    });
  });

  describe('📊 Leaderboard Fetching', () => {
    test('should fetch global leaderboard successfully', async () => {
      // Arrange
      const options = {
        limit: 10,
        offset: 0,
        period: 'all_time'
      };

      // Mock cache miss
      mockCache.get.mockResolvedValue(null);

      // Mock database queries
      const mockLeaderboardData = [
        {
          id: 'score-1',
          player_id: 'player-1',
          nickname: 'TopPlayer',
          score: 500,
          survival_time: 120000,
          skin_used: 'supreme_jet',
          theme: 'Supreme',
          achieved_at: new Date()
        },
        {
          id: 'score-2',
          player_id: 'player-2',
          nickname: 'SecondPlace',
          score: 450,
          survival_time: 110000,
          skin_used: 'stealth_bomber',
          theme: 'Stealth',
          achieved_at: new Date()
        }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: mockLeaderboardData }) // Leaderboard query
        .mockResolvedValueOnce({ rows: [{ total: '25' }] }); // Count query

      // Act
      const result = await leaderboardService.getGlobalLeaderboard(options);

      // Assert
      expect(result.success).toBe(true);
      expect(result.leaderboard).toHaveLength(2);
      expect(result.leaderboard[0].nickname).toBe('TopPlayer');
      expect(result.leaderboard[0].rank).toBe(1);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.hasMore).toBe(true);

      // Verify caching
      expect(mockCache.set).toHaveBeenCalled();
    });

    test('should return cached leaderboard when available', async () => {
      // Arrange
      const cachedResponse = {
        success: true,
        leaderboard: [
          { rank: 1, nickname: 'CachedPlayer', score: 300 }
        ],
        pagination: { limit: 10, offset: 0, total: 1, hasMore: false }
      };

      mockCache.get.mockResolvedValue(cachedResponse);

      // Act
      const result = await leaderboardService.getGlobalLeaderboard();

      // Assert
      expect(result).toEqual({ ...cachedResponse, fromCache: true });
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    test('should handle pagination correctly', async () => {
      // Arrange
      const options = {
        limit: 5,
        offset: 10,
        period: 'weekly'
      };

      mockCache.get.mockResolvedValue(null);
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // Leaderboard
        .mockResolvedValueOnce({ rows: [{ total: '50' }] }); // Count

      // Act
      const result = await leaderboardService.getGlobalLeaderboard(options);

      // Assert
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.offset).toBe(10);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  describe('🎯 Player Context', () => {
    test('should fetch player context successfully', async () => {
      // Arrange
      const playerId = 'player-123';

      // Mock player rank query
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ rank: 5, score: 200, achieved_at: new Date() }]
        })
        .mockResolvedValueOnce({
          rows: [
            { rank: 3, player_id: 'player-1', nickname: 'Player1', score: 250, isCurrentPlayer: false },
            { rank: 4, player_id: 'player-2', nickname: 'Player2', score: 225, isCurrentPlayer: false },
            { rank: 5, player_id: 'player-123', nickname: 'TestPlayer', score: 200, isCurrentPlayer: true },
            { rank: 6, player_id: 'player-3', nickname: 'Player3', score: 175, isCurrentPlayer: false },
            { rank: 7, player_id: 'player-4', nickname: 'Player4', score: 150, isCurrentPlayer: false }
          ]
        });

      // Act
      const result = await leaderboardService.getPlayerContext(playerId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.playerRank).toBe(5);
      expect(result.playerScore).toBe(200);
      expect(result.context).toHaveLength(5);
      
      const currentPlayerEntry = result.context.find(entry => entry.isCurrentPlayer);
      expect(currentPlayerEntry).toBeTruthy();
      expect(currentPlayerEntry.player_id).toBe(playerId);
    });

    test('should handle player not found', async () => {
      // Arrange
      const playerId = 'nonexistent-player';

      mockDb.query.mockResolvedValueOnce({ rows: [] });

      // Act
      const result = await leaderboardService.getPlayerContext(playerId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Player not found');
    });
  });

  describe('📈 Statistics', () => {
    test('should fetch leaderboard statistics', async () => {
      // Arrange
      const period = 'all_time';
      const mockStats = {
        total_players: '1250',
        total_scores: '5000',
        average_score: '125.5',
        highest_score: '750',
        last_updated: new Date()
      };

      mockCache.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValueOnce({ rows: [mockStats] });

      // Act
      const result = await leaderboardService.getLeaderboardStats(period);

      // Assert
      expect(result.totalPlayers).toBe(1250);
      expect(result.totalScores).toBe(5000);
      expect(result.averageScore).toBe(125.5);
      expect(result.highestScore).toBe(750);
      expect(mockCache.set).toHaveBeenCalled();
    });
  });

  describe('🔧 Private Methods', () => {
    test('should validate score data correctly', () => {
      // Test valid data
      expect(() => {
        leaderboardService._validateScoreData({
          score: 100,
          survivalTime: 30000,
          gameDuration: 35000
        });
      }).not.toThrow();

      // Test invalid score
      expect(() => {
        leaderboardService._validateScoreData({ score: -10 });
      }).toThrow('Invalid score');

      // Test score too high
      expect(() => {
        leaderboardService._validateScoreData({ score: 200000 });
      }).toThrow('exceeds maximum');

      // Test invalid survival time
      expect(() => {
        leaderboardService._validateScoreData({
          score: 100,
          survivalTime: -5000
        });
      }).toThrow('Invalid survival time');

      // Test suspicious ratio
      expect(() => {
        leaderboardService._validateScoreData({
          score: 1000,
          survivalTime: 5000 // 200 points/second
        });
      }).toThrow('Invalid score-to-time ratio');
    });

    test('should build period where clauses correctly', () => {
      expect(leaderboardService._buildPeriodWhereClause('daily'))
        .toContain("INTERVAL '1 day'");
      
      expect(leaderboardService._buildPeriodWhereClause('weekly'))
        .toContain("INTERVAL '1 week'");
      
      expect(leaderboardService._buildPeriodWhereClause('monthly'))
        .toContain("INTERVAL '1 month'");
      
      expect(leaderboardService._buildPeriodWhereClause('all_time'))
        .toBe('');
    });
  });

  describe('🔄 Cache Integration', () => {
    test('should invalidate caches on score submission', async () => {
      // Arrange
      const playerId = 'player-123';
      const scoreData = { score: 100, survivalTime: 30000, skinUsed: 'sky_jet' };

      mockAntiCheat.validateScore.mockResolvedValue({ isValid: true });
      mockDb.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'score-123' }] })
        .mockResolvedValueOnce({ rows: [{ rank: 1 }] });

      // Act
      await leaderboardService.submitScore(playerId, scoreData);

      // Assert
      expect(mockCache.deletePattern).toHaveBeenCalledWith('leaderboard:global:*');
      expect(mockCache.deletePattern).toHaveBeenCalledWith('leaderboard:stats:*');
      expect(mockCache.deletePattern).toHaveBeenCalledWith('leaderboard:player:*');
    });
  });
});
