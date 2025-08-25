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
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: mockTournamentId, name: 'Weekly Championship 2024-01-15' }]
      });

      const result = await tournamentManager.createWeeklyTournament();

      expect(result.success).toBe(true);
      expect(result.tournament.id).toBe(mockTournamentId);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT create_weekly_tournament'),
        expect.any(Array)
      );
    });

    test('should create tournament with custom prize pool', async () => {
      const mockTournamentId = '123e4567-e89b-12d3-a456-426614174000';
      const customPrizePool = 5000;
      
      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: mockTournamentId }]
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
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ 
            tournament_id: mockTournamentId,
            player_id: mockPlayerId,
            best_score: 1200
          }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'updated-participant' }] // Score update result
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'leaderboard-entry' }] // Leaderboard snapshot
        })
        .mockResolvedValueOnce({
          rows: [
            { player_id: mockPlayerId, player_name: 'TestPlayer', score: 1500, rank: 1 },
            { player_id: 'other-player', player_name: 'OtherPlayer', score: 1400, rank: 2 }
          ]
        });

      const result = await tournamentManager.submitScore(mockTournamentId, {
        playerId: mockPlayerId,
        score: score,
        gameData: { duration: 120, obstacles: 15 }
      });

      expect(result.success).toBe(true);
      expect(result.newBest).toBe(true);
      expect(result.rank).toBe(1);
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
      mockDb.query.mockResolvedValueOnce({
        rows: [{ 
          tournament_id: mockTournamentId,
          player_id: mockPlayerId,
          best_score: 2000 // Higher than submitted score
        }]
      });

      const result = await tournamentManager.submitScore(mockTournamentId, {
        playerId: mockPlayerId,
        score: 1500
      });

      expect(result.success).toBe(true);
      expect(result.newBest).toBe(false);
      expect(mockDb.query).toHaveBeenCalledTimes(1); // Only the participant check
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
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tournaments SET status = $1'),
        ['active', mockTournamentId]
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
        { player_id: 'player1', player_name: 'Winner', score: 2000, rank: 1 },
        { player_id: 'player2', player_name: 'Second', score: 1800, rank: 2 },
        { player_id: 'player3', player_name: 'Third', score: 1600, rank: 3 }
      ];

      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ 
            id: mockTournamentId, 
            prize_pool: 1000,
            prize_distribution: { "1": 0.5, "2": 0.3, "3": 0.2 }
          }]
        })
        .mockResolvedValueOnce({
          rows: mockLeaderboard
        })
        .mockResolvedValueOnce({
          rows: [{ id: mockTournamentId }] // Tournament status update
        });

      mockPrizeManager.distributePrizes.mockResolvedValue({
        success: true,
        distributions: [
          { playerId: 'player1', amount: 500 },
          { playerId: 'player2', amount: 300 },
          { playerId: 'player3', amount: 200 }
        ]
      });

      const result = await tournamentManager.endTournament(mockTournamentId);

      expect(result.success).toBe(true);
      expect(result.finalLeaderboard).toHaveLength(3);
      expect(mockPrizeManager.distributePrizes).toHaveBeenCalledWith(
        mockTournamentId,
        mockLeaderboard,
        { "1": 0.5, "2": 0.3, "3": 0.2 },
        1000
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
