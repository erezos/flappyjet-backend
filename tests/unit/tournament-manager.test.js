/**
 * Tournament Manager Unit Tests
 * TDD implementation for weekly competitions with prizes
 */

const TournamentManager = require('../../services/tournament-manager');
const { ValidationException, NetworkException } = require('../../utils/exceptions');

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

const mockPrizeManager = {
  distributePrizes: jest.fn(),
  validatePrizeDistribution: jest.fn(),
  creditPlayerAccount: jest.fn()
};

const mockWebSocketManager = {
  broadcastToRoom: jest.fn(),
  notifyPlayer: jest.fn()
};

describe('TournamentManager', () => {
  let tournamentManager;

  beforeEach(() => {
    jest.clearAllMocks();
    tournamentManager = new TournamentManager({
      db: mockDb,
      cacheManager: mockCacheManager,
      prizeManager: mockPrizeManager,
      wsManager: mockWebSocketManager
    });
  });

  describe('Tournament Creation', () => {
    test('should create weekly tournament with default settings', async () => {
      const mockTournamentId = '123e4567-e89b-12d3-a456-426614174000';

      // Mock the database function call
      mockDb.query.mockResolvedValueOnce({
        rows: [{ tournament_id: mockTournamentId }]
      });

      // Mock the tournament details query
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: mockTournamentId,
          name: 'Weekly Championship 2024-01-15',
          tournament_type: 'weekly',
          start_date: new Date(),
          end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'upcoming',
          prize_pool: 1750
        }]
      });

      const result = await tournamentManager.createWeeklyTournament();

      expect(result.success).toBe(true);
      expect(result.tournament).toBeDefined();
      expect(result.tournament.id).toBe(mockTournamentId);
      expect(result.tournament.prizePool).toBe(1750);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT create_weekly_tournament'),
        expect.any(Array)
      );
    });

    test('should create tournament with custom prize pool', async () => {
      const mockTournamentId = '123e4567-e89b-12d3-a456-426614174000';
      const customPrizePool = 5000;

      // Mock the database function call
      mockDb.query.mockResolvedValueOnce({
        rows: [{ tournament_id: mockTournamentId }]
      });

      // Mock the tournament details query
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: mockTournamentId,
          name: 'Super Weekly Championship',
          tournament_type: 'weekly',
          start_date: new Date(),
          end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'upcoming',
          prize_pool: customPrizePool
        }]
      });

      const result = await tournamentManager.createWeeklyTournament({
        prizePool: customPrizePool,
        name: 'Super Weekly Championship'
      });

      expect(result.success).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('create_weekly_tournament'),
        expect.arrayContaining(['Super Weekly Championship', customPrizePool])
      );
    });

    test('should reject invalid prize pool', async () => {
      const result = await tournamentManager.createWeeklyTournament({
        prizePool: -100
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Prize pool must be non-negative');
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  describe('Tournament Registration', () => {
    const mockTournamentId = '123e4567-e89b-12d3-a456-426614174000';
    const mockPlayerId = '987fcdeb-51a2-43d1-9f4e-123456789abc';

    test('should register player for tournament', async () => {
      // Mock tournament exists and is accepting registrations
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ 
            id: mockTournamentId, 
            status: 'upcoming',
            entry_fee: 0,
            max_participants: null
          }]
        })
        .mockResolvedValueOnce({
          rows: [{ count: '50' }] // Current participant count
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'participant-id' }] // Registration result
        });

      const result = await tournamentManager.registerPlayer(mockTournamentId, {
        playerId: mockPlayerId,
        playerName: 'TestPlayer'
      });

      expect(result.success).toBe(true);
      expect(mockDb.query).toHaveBeenCalledTimes(3);
      expect(mockWebSocketManager.notifyPlayer).toHaveBeenCalledWith(
        mockPlayerId,
        expect.objectContaining({
          type: 'tournament_registered'
        })
      );
    });

    test('should reject registration for ended tournament', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{ 
          id: mockTournamentId, 
          status: 'ended'
        }]
      });

      const result = await tournamentManager.registerPlayer(mockTournamentId, {
        playerId: mockPlayerId,
        playerName: 'TestPlayer'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tournament registration is closed');
    });

    test('should reject duplicate registration', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ 
            id: mockTournamentId, 
            status: 'upcoming'
          }]
        })
        .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

      const result = await tournamentManager.registerPlayer(mockTournamentId, {
        playerId: mockPlayerId,
        playerName: 'TestPlayer'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });
  });

  describe('Score Submission', () => {
    const mockTournamentId = '123e4567-e89b-12d3-a456-426614174000';
    const mockPlayerId = '987fcdeb-51a2-43d1-9f4e-123456789abc';

    test('should submit tournament score and update leaderboard', async () => {
      const score = 1500;

      // Mock participant exists and tournament is active
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          tournament_id: mockTournamentId,
          player_id: mockPlayerId,
          player_name: 'TestPlayer',
          best_score: 1200,
          total_games: 5
        }]
      });

      // Mock score update (new best score)
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: 'updated-participant' }]
      });

      // Mock leaderboard snapshot creation
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: 'leaderboard-entry' }]
      });

      // Mock rank query - no players have higher scores, so rank should be 1
      mockDb.query.mockResolvedValueOnce({
        rows: [{ rank: 1 }]
      });

      // Mock event logging
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: 'event-id' }]
      });

      // Mock leaderboard query for WebSocket broadcast
      mockDb.query.mockResolvedValueOnce({
        rows: [
          { player_id: mockPlayerId, player_name: 'TestPlayer', score: 1500, rank: 1, total_games: 6, final_rank: null, prize_won: null }
        ]
      });

      const result = await tournamentManager.submitScore(mockTournamentId, {
        playerId: mockPlayerId,
        score: score,
        gameData: { duration: 120, obstacles: 15 }
      });

      // Debug: log the actual result to see what's wrong
      if (!result.success) {
        console.log('Test failed with result:', result);
      }

      expect(result.success).toBe(true);
      expect(result.newBest).toBe(true);
      expect(result.rank).toBe(1);
      expect(result.score).toBe(1500);
      expect(result.previousBest).toBe(1200);
      expect(result.totalGames).toBe(6);
      expect(mockWebSocketManager.broadcastToRoom).toHaveBeenCalledWith(
        `tournament_${mockTournamentId}`,
        expect.objectContaining({
          type: 'leaderboard_update'
        })
      );
    });

    test('should reject score for non-participant', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [] // No participant found
      });

      const result = await tournamentManager.submitScore(mockTournamentId, {
        playerId: mockPlayerId,
        score: 1500
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not registered');
    });

    test('should not update if score is not better', async () => {
      // Mock participant exists with higher score
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          tournament_id: mockTournamentId,
          player_id: mockPlayerId,
          player_name: 'TestPlayer',
          best_score: 2000, // Higher than submitted score
          total_games: 5
        }]
      });

      // Mock games increment (not score update since it's not a new best)
      mockDb.query.mockResolvedValueOnce({
        rows: []
      });

      // Mock rank query
      mockDb.query.mockResolvedValueOnce({
        rows: [{ rank: 2 }] // Player is ranked 2nd since someone has higher score
      });

      // Mock event logging
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: 'event-id' }]
      });

      const result = await tournamentManager.submitScore(mockTournamentId, {
        playerId: mockPlayerId,
        score: 1500
      });

      expect(result.success).toBe(true);
      expect(result.newBest).toBe(false);
      expect(result.score).toBe(1500);
      expect(result.previousBest).toBe(2000);
      expect(result.rank).toBe(2);
      expect(result.totalGames).toBe(6);
      expect(mockDb.query).toHaveBeenCalledTimes(4); // participant check, games increment, rank query, event logging
    });
  });

  describe('Tournament Lifecycle', () => {
    const mockTournamentId = '123e4567-e89b-12d3-a456-426614174000';

    test('should start tournament and notify participants', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: mockTournamentId }] // Tournament update
        })
        .mockResolvedValueOnce({
          rows: [
            { player_id: 'player1', player_name: 'Player1' },
            { player_id: 'player2', player_name: 'Player2' }
          ]
        });

      const result = await tournamentManager.startTournament(mockTournamentId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('started successfully');
      expect(result.participantCount).toBe(2);

      // Check that the tournament update was called (1st call)
      expect(mockDb.query).toHaveBeenNthCalledWith(1,
        expect.stringContaining('UPDATE tournaments SET status = $1, updated_at = NOW() WHERE id = $2 AND status = \'upcoming\''),
        ['active', mockTournamentId]
      );

      // Check that participants query was called (2nd call)
      expect(mockDb.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('SELECT player_id, player_name FROM tournament_participants'),
        [mockTournamentId]
      );
      expect(mockWebSocketManager.broadcastToRoom).toHaveBeenCalledWith(
        `tournament_${mockTournamentId}`,
        expect.objectContaining({
          type: 'tournament_started'
        })
      );
    });

    test('should end tournament and distribute prizes', async () => {
      const mockLeaderboard = [
        { player_id: 'player1', player_name: 'Winner', score: 2000, rank: 1, total_games: 10, final_rank: null, prize_won: null },
        { player_id: 'player2', player_name: 'Second', score: 1800, rank: 2, total_games: 8, final_rank: null, prize_won: null },
        { player_id: 'player3', player_name: 'Third', score: 1600, rank: 3, total_games: 6, final_rank: null, prize_won: null }
      ];

      // Mock tournament details query
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: mockTournamentId,
          name: 'Test Tournament',
          prize_pool: 1000,
          prize_distribution: { "1": 0.5, "2": 0.3, "3": 0.2 },
          status: 'active'
        }]
      });

      // Mock _getTournamentLeaderboard call
      mockDb.query.mockResolvedValueOnce({
        rows: mockLeaderboard
      });

      // Mock prize distribution
      mockPrizeManager.distributePrizes.mockResolvedValue({
        success: true,
        distributions: [
          { playerId: 'player1', amount: 500 },
          { playerId: 'player2', amount: 300 },
          { playerId: 'player3', amount: 200 }
        ],
        totalDistributed: 1000
      });

      // Mock leaderboard snapshot creations (3 players)
      mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'snapshot1' }] });
      mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'snapshot2' }] });
      mockDb.query.mockResolvedValueOnce({ rows: [{ id: 'snapshot3' }] });

      // Mock tournament status update
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: mockTournamentId }]
      });

      // Mock event logging
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: 'event-id' }]
      });

      const result = await tournamentManager.endTournament(mockTournamentId);

      // Debug: log the actual result to see what's wrong
      if (!result.success) {
        console.log('End tournament test failed with result:', result);
      }

      expect(result.success).toBe(true);
      expect(result.finalLeaderboard).toHaveLength(3);
      expect(result.prizeDistributions).toHaveLength(3);
      expect(result.totalPrizesDistributed).toBe(1000);
      expect(result.message).toContain('ended successfully');
      expect(mockPrizeManager.distributePrizes).toHaveBeenCalledWith(
        mockTournamentId,
        mockLeaderboard,
        { "1": 0.5, "2": 0.3, "3": 0.2 },
        1000
      );
      expect(mockWebSocketManager.broadcastToRoom).toHaveBeenCalledWith(
        `tournament_${mockTournamentId}`,
        expect.objectContaining({
          type: 'tournament_ended'
        })
      );
    });
  });

  describe('Tournament Queries', () => {
    test('should get current active tournament', async () => {
      const mockTournament = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Weekly Championship',
        status: 'active',
        prize_pool: 1000,
        participant_count: 150,
        time_remaining: '2 days 5 hours'
      };

      mockDb.query.mockResolvedValueOnce({
        rows: [mockTournament]
      });

      const result = await tournamentManager.getCurrentTournament();

      expect(result.success).toBe(true);
      expect(result.tournament).toEqual(mockTournament);
    });

    test('should get tournament leaderboard', async () => {
      const mockTournamentId = '123e4567-e89b-12d3-a456-426614174000';
      const mockLeaderboard = [
        { player_id: 'player1', player_name: 'Leader', score: 2000, rank: 1 },
        { player_id: 'player2', player_name: 'Second', score: 1800, rank: 2 }
      ];

      mockDb.query.mockResolvedValueOnce({
        rows: mockLeaderboard
      });

      const result = await tournamentManager.getTournamentLeaderboard(mockTournamentId, {
        limit: 10,
        offset: 0
      });

      expect(result.success).toBe(true);
      expect(result.leaderboard).toEqual(mockLeaderboard);
    });

    test('should get player tournament stats', async () => {
      const mockPlayerId = '987fcdeb-51a2-43d1-9f4e-123456789abc';
      const mockStats = {
        tournaments_joined: 5,
        best_rank: 2,
        total_prizes: 800,
        current_tournament_rank: 3
      };

      mockDb.query.mockResolvedValueOnce({
        rows: [mockStats]
      });

      const result = await tournamentManager.getPlayerStats(mockPlayerId);

      expect(result.success).toBe(true);
      expect(result.stats).toEqual(mockStats);
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Connection timeout'));

      const result = await tournamentManager.getCurrentTournament();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });

    test('should handle invalid tournament ID format', async () => {
      const result = await tournamentManager.getTournamentLeaderboard('invalid-uuid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid tournament ID');
    });
  });
});
