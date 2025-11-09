/**
 * Unit Tests for PrizeCalculator
 * Tests prize distribution logic
 */

const PrizeCalculator = require('../../services/prize-calculator');

describe('PrizeCalculator', () => {
  let mockDb;
  let calculator;

  beforeEach(() => {
    mockDb = {
      query: jest.fn()
    };

    calculator = new PrizeCalculator(mockDb);
  });

  describe('getPrizePool', () => {
    test('should return correct prize pool configuration', () => {
      const prizePool = calculator.getPrizePool();

      expect(prizePool).toHaveLength(5);
      expect(prizePool[0]).toEqual({ ranks: [1], coins: 5000, gems: 250 });
      expect(prizePool[1]).toEqual({ ranks: [2], coins: 3000, gems: 150 });
      expect(prizePool[2]).toEqual({ ranks: [3], coins: 2000, gems: 100 });
      expect(prizePool[3]).toEqual({ ranks: [4, 5, 6, 7, 8, 9, 10], coins: 1000, gems: 50 });
      expect(prizePool[4].coins).toBe(500);
      expect(prizePool[4].gems).toBe(25);
      expect(prizePool[4].ranks).toHaveLength(40); // Ranks 11-50
    });
  });

  describe('getPrizeForRank', () => {
    test('should return correct prize for rank 1', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(1, prizePool);

      expect(prize).toEqual({ coins: 5000, gems: 250 });
    });

    test('should return correct prize for rank 2', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(2, prizePool);

      expect(prize).toEqual({ coins: 3000, gems: 150 });
    });

    test('should return correct prize for rank 3', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(3, prizePool);

      expect(prize).toEqual({ coins: 2000, gems: 100 });
    });

    test('should return correct prize for rank 5', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(5, prizePool);

      expect(prize).toEqual({ coins: 1000, gems: 50 });
    });

    test('should return correct prize for rank 25', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(25, prizePool);

      expect(prize).toEqual({ coins: 500, gems: 25 });
    });

    test('should return correct prize for rank 50', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(50, prizePool);

      expect(prize).toEqual({ coins: 500, gems: 25 });
    });

    test('should return null for rank 51', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(51, prizePool);

      expect(prize).toBeNull();
    });

    test('should return null for rank 100', () => {
      const prizePool = calculator.getPrizePool();
      const prize = calculator.getPrizeForRank(100, prizePool);

      expect(prize).toBeNull();
    });
  });

  describe('calculateTournamentPrizes', () => {
    test('should calculate prizes for top 3 winners', async () => {
      const tournamentId = 'weekly_2025_01';
      const tournamentName = 'Weekly Championship';

      // Mock tournament winners
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            { user_id: 'device_1st', nickname: 'Champion', best_score: 500, rank: 1 },
            { user_id: 'device_2nd', nickname: 'Runner Up', best_score: 400, rank: 2 },
            { user_id: 'device_3rd', nickname: 'Bronze', best_score: 300, rank: 3 }
          ]
        })
        // Mock existing prize checks (3 checks)
        .mockResolvedValue({ rows: [] })
        .mockResolvedValue({ rows: [] })
        .mockResolvedValue({ rows: [] })
        // Mock prize inserts (3 inserts)
        .mockResolvedValue({ rows: [] })
        .mockResolvedValue({ rows: [] })
        .mockResolvedValue({ rows: [] });

      const result = await calculator.calculateTournamentPrizes(tournamentId, tournamentName);

      expect(result.success).toBe(true);
      expect(result.prizes_awarded).toBe(3);
      expect(result.prize_details).toHaveLength(3);
      
      // Verify first place
      expect(result.prize_details[0]).toMatchObject({
        user_id: 'device_1st',
        rank: 1,
        coins: 5000,
        gems: 250
      });
    });

    test('should not award duplicate prizes', async () => {
      const tournamentId = 'weekly_2025_02';
      const tournamentName = 'Weekly Championship';

      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            { user_id: 'device_123', nickname: 'Winner', best_score: 999, rank: 1 }
          ]
        })
        // Mock existing prize (duplicate)
        .mockResolvedValueOnce({ rows: [{ user_id: 'device_123' }] });

      const result = await calculator.calculateTournamentPrizes(tournamentId, tournamentName);

      expect(result.success).toBe(true);
      expect(result.prizes_awarded).toBe(0); // No new prizes
    });

    test('should handle tournament with no participants', async () => {
      const tournamentId = 'weekly_2025_03';
      const tournamentName = 'Empty Tournament';

      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await calculator.calculateTournamentPrizes(tournamentId, tournamentName);

      expect(result.success).toBe(true);
      expect(result.prizes_awarded).toBe(0);
      expect(result.message).toBe('No participants');
    });

    test('should award prizes to exactly 50 players', async () => {
      const tournamentId = 'weekly_2025_04';
      const tournamentName = 'Full Tournament';

      // Generate 50 winners
      const winners = Array.from({ length: 50 }, (_, i) => ({
        user_id: `device_${i + 1}`,
        nickname: `Player ${i + 1}`,
        best_score: 1000 - (i * 10),
        rank: i + 1
      }));

      mockDb.query
        .mockResolvedValueOnce({ rows: winners })
        .mockResolvedValue({ rows: [] }); // All other queries succeed

      const result = await calculator.calculateTournamentPrizes(tournamentId, tournamentName);

      expect(result.success).toBe(true);
      expect(result.prizes_awarded).toBe(50);
    });

    test('should handle database errors', async () => {
      const tournamentId = 'weekly_2025_05';
      const tournamentName = 'Error Tournament';

      mockDb.query.mockRejectedValue(new Error('Database connection lost'));

      const result = await calculator.calculateTournamentPrizes(tournamentId, tournamentName);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection lost');
    });
  });

  describe('processLastWeekPrizes', () => {
    test('should find and process completed tournament', async () => {
      // Mock tournaments table query
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              tournament_id: 'weekly_2025_10',
              name: 'Last Week Championship',
              end_date: new Date('2025-01-07')
            }
          ]
        })
        // Mock winners
        .mockResolvedValueOnce({
          rows: [
            { user_id: 'device_winner', nickname: 'Winner', best_score: 999, rank: 1 }
          ]
        })
        // Mock existing prize check
        .mockResolvedValueOnce({ rows: [] })
        // Mock prize insert
        .mockResolvedValueOnce({ rows: [] })
        // Mock tournament update
        .mockResolvedValueOnce({ rows: [] });

      const result = await calculator.processLastWeekPrizes();

      expect(result.success).toBe(true);
      expect(result.prizes_awarded).toBe(1);
    });

    test('should handle no tournaments needing processing', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // No tournaments
        .mockResolvedValueOnce({ rows: [] }); // Fallback also empty

      const result = await calculator.processLastWeekPrizes();

      expect(result.success).toBe(true);
      expect(result.message).toBe('No tournaments to process');
    });
  });

  describe('getStats', () => {
    test('should return calculator statistics', () => {
      const stats = calculator.getStats();

      expect(stats).toHaveProperty('tournaments_processed');
      expect(stats).toHaveProperty('total_prizes_awarded');
      expect(stats).toHaveProperty('last_calculation');
      expect(stats).toHaveProperty('last_calculation_ago_hours');
    });
  });
});

