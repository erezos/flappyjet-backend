/// 🧪 Leaderboard Routes Unit Tests
const request = require('supertest');
const express = require('express');
const leaderboardRoutes = require('../../routes/leaderboard');
const authRoutes = require('../../routes/auth');

describe('Leaderboard Routes', () => {
  let app;
  let mockDb;
  let testPlayerId;
  let authToken;

  beforeEach(() => {
    // Create mock database
    mockDb = global.testHelpers.mockDatabase();
    
    // Create Express app with routes
    app = express();
    app.use(express.json());
    
    const authRouter = authRoutes(mockDb);
    const leaderboardRouter = leaderboardRoutes(mockDb);
    
    app.use('/api/auth', authRouter);
    app.use('/api/leaderboard', leaderboardRouter);
    
    // Set up test player and token
    testPlayerId = 'test-player-id';
    authToken = global.testHelpers.generateTestToken(testPlayerId);
  });

  describe('POST /api/leaderboard/submit', () => {
    it('should submit score successfully', async () => {
      // Mock anti-cheat validation
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [{ is_valid: true }] }) // Score validation
        .mockResolvedValueOnce({ // Score insertion
          rows: [{
            id: 'score-id-123',
            created_at: new Date().toISOString()
          }]
        })
        .mockResolvedValueOnce({}) // Player stats update
        .mockResolvedValueOnce({}) // Achievement check queries
        .mockResolvedValueOnce({}) // Mission progress queries
        .mockResolvedValueOnce({ rows: [{ rank: 42 }] }) // Rank calculation
        .mockResolvedValueOnce({ rows: [{ best_score: 50 }] }); // Personal best check

      const scoreData = {
        score: 42,
        survivalTime: 30,
        skinUsed: 'sky_jet',
        coinsEarned: 15,
        gemsEarned: 2,
        gameDuration: 30000,
        actionsPerSecond: 1.4
      };

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send(scoreData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.scoreId).toBe('score-id-123');
      expect(response.body.rank).toBe(42);
      expect(response.body.coinsEarned).toBe(15);
      expect(response.body.gemsEarned).toBe(2);
      expect(response.body.submittedAt).toHaveValidTimestamp();
    });

    it('should reject invalid score data', async () => {
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: -10, // Invalid negative score
          survivalTime: 30,
          gameDuration: 30000
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('score');
    });

    it('should reject score without authentication', async () => {
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .send({
          score: 42,
          survivalTime: 30,
          gameDuration: 30000
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should reject suspicious scores', async () => {
      // Mock anti-cheat validation failure
      mockDb.mockQuery.mockResolvedValueOnce({ rows: [{ is_valid: false }] });

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 999999, // Suspiciously high score
          survivalTime: 1,
          gameDuration: 1000
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid score submission');
    });

    it('should validate survival time constraints', async () => {
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 42,
          survivalTime: 5000, // Too long (> 3600 seconds)
          gameDuration: 30000
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('survivalTime');
    });

    it('should validate game duration constraints', async () => {
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 42,
          survivalTime: 30,
          gameDuration: 500 // Too short (< 1000ms)
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('gameDuration');
    });

    it('should handle database errors gracefully', async () => {
      mockDb.mockQuery.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 42,
          survivalTime: 30,
          gameDuration: 30000
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to submit score');
    });
  });

  describe('GET /api/leaderboard/global', () => {
    it('should return global leaderboard successfully', async () => {
      const mockLeaderboard = [
        {
          rank: 1,
          player_id: 'player-1',
          nickname: 'TopPlayer',
          score: 100,
          skin_used: 'diamond_jet',
          achieved_at: new Date().toISOString(),
          country_code: 'US',
          is_current_player: false
        },
        {
          rank: 2,
          player_id: testPlayerId,
          nickname: 'TestPlayer',
          score: 90,
          skin_used: 'sky_jet',
          achieved_at: new Date().toISOString(),
          country_code: 'CA',
          is_current_player: true
        }
      ];

      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: mockLeaderboard }) // Leaderboard data
        .mockResolvedValueOnce({ rows: [{ total: 150 }] }); // Total count

      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 10, offset: 0, playerId: testPlayerId });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.leaderboard).toHaveLength(2);
      expect(response.body.leaderboard[0]).toMatchObject({
        rank: 1,
        nickname: 'TopPlayer',
        score: 100
      });
      expect(response.body.leaderboard[1].is_current_player).toBe(true);
      expect(response.body.pagination).toMatchObject({
        limit: 10,
        offset: 0,
        total: 150
      });
    });

    it('should handle different time periods', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ period: 'weekly' });

      expect(response.status).toBe(200);
      expect(response.body.period).toBe('weekly');
    });

    it('should limit maximum results', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 1000 }); // Should be capped at 500

      expect(response.status).toBe(200);
      // Check that the query was called with limit 500, not 1000
      expect(mockDb.mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1'),
        expect.arrayContaining([500])
      );
    });

    it('should handle database errors', async () => {
      mockDb.mockQuery.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/leaderboard/global');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch leaderboard');
    });
  });

  describe('GET /api/leaderboard/player/:playerId', () => {
    it('should return player rank and context', async () => {
      const mockPlayerRank = [{
        rank: 42,
        score: 85,
        nickname: 'TestPlayer',
        player_best_score: 85
      }];

      const mockContext = [
        { rank: 40, player_id: 'player-40', nickname: 'Player40', score: 87, is_current_player: false },
        { rank: 41, player_id: 'player-41', nickname: 'Player41', score: 86, is_current_player: false },
        { rank: 42, player_id: testPlayerId, nickname: 'TestPlayer', score: 85, is_current_player: true },
        { rank: 43, player_id: 'player-43', nickname: 'Player43', score: 84, is_current_player: false },
        { rank: 44, player_id: 'player-44', nickname: 'Player44', score: 83, is_current_player: false }
      ];

      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: mockPlayerRank }) // Player rank query
        .mockResolvedValueOnce({ rows: mockContext }); // Context query

      const response = await request(app)
        .get(`/api/leaderboard/player/${testPlayerId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.player).toMatchObject({
        rank: 42,
        score: 85,
        nickname: 'TestPlayer'
      });
      expect(response.body.context).toHaveLength(5);
      expect(response.body.context[2].is_current_player).toBe(true);
    });

    it('should handle player with no scores', async () => {
      mockDb.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get(`/api/leaderboard/player/${testPlayerId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.rank).toBeNull();
      expect(response.body.score).toBe(0);
      expect(response.body.message).toBe('Player has no scores in this period');
    });

    it('should handle different time periods', async () => {
      mockDb.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get(`/api/leaderboard/player/${testPlayerId}`)
        .query({ period: 'daily' });

      expect(response.status).toBe(200);
      expect(response.body.period).toBe('daily');
    });
  });

  describe('Anti-Cheat System', () => {
    it('should detect impossible scores', async () => {
      mockDb.mockQuery.mockResolvedValueOnce({ rows: [{ is_valid: false }] });

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 1000000, // Impossible score
          survivalTime: 1,
          gameDuration: 1000
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid score submission');
    });

    it('should detect rapid scoring', async () => {
      mockDb.mockQuery.mockResolvedValueOnce({ rows: [{ is_valid: false }] });

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 100,
          survivalTime: 10,
          gameDuration: 5000, // Very short game for high score
          actionsPerSecond: 25 // Too many actions per second
        });

      expect(response.status).toBe(400);
    });

    it('should allow legitimate scores', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [{ is_valid: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'score-123', created_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({}) // Player update
        .mockResolvedValueOnce({}) // Achievements
        .mockResolvedValueOnce({}) // Missions
        .mockResolvedValueOnce({ rows: [{ rank: 10 }] })
        .mockResolvedValueOnce({ rows: [{ best_score: 30 }] });

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 35,
          survivalTime: 25,
          gameDuration: 25000,
          actionsPerSecond: 1.4
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Achievement Integration', () => {
    it('should trigger score-based achievements', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [{ is_valid: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'score-123', created_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({}) // Player update
        .mockResolvedValueOnce({}) // Achievement updates (multiple calls expected)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ total_games_played: 15 }] }) // Games played query
        .mockResolvedValueOnce({}) // Game achievement updates
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}) // Mission updates
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ rank: 5 }] })
        .mockResolvedValueOnce({ rows: [{ best_score: 20 }] });

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 25, // Should trigger 'cloud_surfer' achievement
          survivalTime: 30,
          gameDuration: 30000
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Verify achievement update was called
      expect(mockDb.mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE player_achievements'),
        expect.arrayContaining([testPlayerId, 'cloud_surfer'])
      );
    });
  });

  describe('Mission Integration', () => {
    it('should update mission progress on score submission', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [{ is_valid: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'score-123', created_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({}) // Player update
        .mockResolvedValueOnce({}) // Achievement checks
        .mockResolvedValueOnce({ rows: [{ total_games_played: 5 }] })
        .mockResolvedValueOnce({}) // Mission progress updates
        .mockResolvedValueOnce({}) // Play games mission
        .mockResolvedValueOnce({}) // Reach score mission
        .mockResolvedValueOnce({}) // Collect coins mission
        .mockResolvedValueOnce({}) // Survive time mission
        .mockResolvedValueOnce({}) // Mark completed missions
        .mockResolvedValueOnce({ rows: [{ rank: 8 }] })
        .mockResolvedValueOnce({ rows: [{ best_score: 15 }] });

      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 20,
          survivalTime: 35,
          coinsEarned: 10,
          gameDuration: 35000
        });

      expect(response.status).toBe(200);
      
      // Verify mission updates were called
      expect(mockDb.mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE player_missions'),
        expect.arrayContaining([testPlayerId, 1]) // Play games +1
      );
    });
  });

  describe('Performance Tests', () => {
    it('should handle concurrent score submissions', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        mockDb.mockQuery
          .mockResolvedValueOnce({ rows: [{ is_valid: true }] })
          .mockResolvedValueOnce({ rows: [{ id: `score-${i}`, created_at: new Date().toISOString() }] })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ rows: [{ total_games_played: i + 1 }] })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ rows: [{ rank: i + 1 }] })
          .mockResolvedValueOnce({ rows: [{ best_score: 10 + i }] });

        promises.push(
          request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              score: 10 + i,
              survivalTime: 20 + i,
              gameDuration: 20000 + i * 1000
            })
        );
      }

      const responses = await Promise.all(promises);
      
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });
});
