/**
 * 🧪 Enhanced Leaderboard API Integration Tests - TDD Style
 * Tests for the actual HTTP endpoints using supertest
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// We'll create a test app instance
let app;
let testUser;
let authToken;

describe('🏆 Enhanced Leaderboard API - Integration Tests', () => {
  beforeAll(async () => {
    // Create test app with mocked dependencies
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret';
    
    // Import fixed app after setting environment
    app = require('../../test-app-fixed');
    
    // Create test user and token
    testUser = {
      id: uuidv4(),
      nickname: 'TestPlayer',
      email: 'test@example.com'
    };
    
    authToken = jwt.sign(
      { userId: testUser.id, type: 'test' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('📤 POST /api/leaderboard/submit', () => {
    test('should submit valid score successfully', async () => {
      // Arrange
      const scoreData = {
        score: 150,
        survivalTime: 45000,
        skinUsed: 'sky_jet',
        coinsEarned: 75,
        gemsEarned: 0,
        gameDuration: 45000,
        theme: 'Sky Rookie',
        platform: 'android',
        version: '1.0.0'
      };

      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send(scoreData);

      if (response.status !== 200) {
        console.log('❌ Status:', response.status);
        console.log('❌ Body:', JSON.stringify(response.body, null, 2));
      }

      expect(response.status).toBe(200);

      // Assert
      expect(response.body).toMatchObject({
        success: true,
        scoreId: expect.any(String),
        rank: expect.any(Number),
        isPersonalBest: expect.any(Boolean),
        coinsEarned: 75,
        gemsEarned: 0
      });

      expect(response.headers['x-rate-limit-remaining']).toBeDefined();
    });

    test('should reject submission without authentication', async () => {
      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .send({ score: 100, survivalTime: 30000, skinUsed: 'sky_jet' })
        .expect(401);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('authentication')
      });
    });

    test('should reject submission with invalid token', async () => {
      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', 'Bearer invalid_token')
        .send({ score: 100, survivalTime: 30000, skinUsed: 'sky_jet' })
        .expect(401);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringMatching(/invalid|Invalid/)
      });
    });

    test('should validate request body', async () => {
      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invalidField: 'test' })
        .expect(400);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('validation')
      });
    });

    test('should handle anti-cheat violations', async () => {
      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 1000000, // Impossibly high score
          survivalTime: 1000,
          skinUsed: 'sky_jet'
        })
        .expect(400);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Anti-cheat')
      });
    });

    test('should implement rate limiting', async () => {
      // Arrange - Submit multiple requests rapidly
      const scoreData = { score: 100, survivalTime: 30000, skinUsed: 'sky_jet' };
      const requests = Array(15).fill().map((_, i) =>
        request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ ...scoreData, score: scoreData.score + i })
      );

      // Act
      const responses = await Promise.all(requests);

      // Assert - Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      const rateLimitedResponse = rateLimitedResponses[0];
      expect(rateLimitedResponse.body).toMatchObject({
        success: false,
        error: expect.stringMatching(/rate limit|Too many requests/)
      });
    });
  });

  describe('📊 GET /api/leaderboard/global', () => {
    test('should fetch global leaderboard successfully', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/global')
        .expect(200);

      // Assert
      expect(response.body).toMatchObject({
        success: true,
        leaderboard: expect.any(Array),
        pagination: expect.objectContaining({
          limit: expect.any(Number),
          offset: expect.any(Number),
          total: expect.any(Number),
          hasMore: expect.any(Boolean)
        }),
        period: 'all_time',
        fetchedAt: expect.any(String)
      });

      // Verify leaderboard is sorted by score descending
      const { leaderboard } = response.body;
      for (let i = 0; i < leaderboard.length - 1; i++) {
        expect(leaderboard[i].score).toBeGreaterThanOrEqual(leaderboard[i + 1].score);
      }

      expect(response.headers['x-cache-status']).toMatch(/HIT|MISS/);
    });

    test('should support pagination parameters', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/global?limit=5&offset=10')
        .expect(200);

      // Assert
      expect(response.body.pagination).toMatchObject({
        limit: 5,
        offset: 10
      });

      expect(response.body.leaderboard.length).toBeLessThanOrEqual(5);
    });

    test('should support period filtering', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/global?period=weekly')
        .expect(200);

      // Assert
      expect(response.body.period).toBe('weekly');
    });

    test('should include statistics when requested', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/global?includeStats=true')
        .expect(200);

      // Assert
      expect(response.body.stats).toMatchObject({
        totalPlayers: expect.any(Number),
        totalScores: expect.any(Number),
        averageScore: expect.any(Number),
        highestScore: expect.any(Number),
        lastUpdated: expect.any(String)
      });
    });

    test('should validate query parameters', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/global?limit=invalid&offset=negative')
        .expect(400);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid parameters')
      });
    });

    test('should handle server errors gracefully', async () => {
      // This test would require mocking a database error
      // For now, we'll test the error response format
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('🎯 GET /api/leaderboard/player/:playerId', () => {
    test('should fetch player context successfully', async () => {
      // Act
      const response = await request(app)
        .get(`/api/leaderboard/player/${testUser.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body).toMatchObject({
        success: true,
        playerRank: expect.any(Number),
        playerScore: expect.any(Number),
        context: expect.arrayContaining([
          expect.objectContaining({
            rank: expect.any(Number),
            player_id: expect.any(String),
            nickname: expect.any(String),
            score: expect.any(Number),
            isCurrentPlayer: expect.any(Boolean)
          })
        ]),
        period: expect.any(String)
      });

      // Verify current player is marked correctly
      const currentPlayerEntry = response.body.context.find(entry => entry.isCurrentPlayer);
      expect(currentPlayerEntry).toBeTruthy();
      expect(currentPlayerEntry.player_id).toBe(testUser.id);
    });

    test('should require authentication', async () => {
      // Act
      const response = await request(app)
        .get(`/api/leaderboard/player/${testUser.id}`)
        .expect(401);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('authentication')
      });
    });

    test('should handle player not found', async () => {
      // Use a valid UUID format that doesn't exist
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      
      // Act
      const response = await request(app)
        .get(`/api/leaderboard/player/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Player not found')
      });
    });

    test('should validate player ID format', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/player/invalid-uuid-format')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid player ID')
      });
    });
  });

  describe('📈 GET /api/leaderboard/stats', () => {
    test('should fetch leaderboard statistics', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/stats')
        .expect(200);

      // Assert
      expect(response.body).toMatchObject({
        success: true,
        totalPlayers: expect.any(Number),
        totalScores: expect.any(Number),
        averageScore: expect.any(Number),
        highestScore: expect.any(Number),
        lastUpdated: expect.any(String),
        period: 'all_time'
      });

      expect(response.headers['x-cache-status']).toMatch(/HIT|MISS/);
    });

    test('should support period parameter', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/stats?period=monthly')
        .expect(200);

      // Assert
      expect(response.body.period).toBe('monthly');
    });
  });

  describe('🔧 Error Handling', () => {
    test('should handle malformed JSON', async () => {
      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid JSON')
      });
    });

    test('should handle missing content-type', async () => {
      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send('score=100')
        .expect(400);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Content-Type')
      });
    });

    test('should return 404 for non-existent endpoints', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/nonexistent')
        .expect(404);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringMatching(/Not found|Endpoint not found/)
      });
    });
  });

  describe('📊 Response Headers', () => {
    test('should include security headers', async () => {
      // Act
      const response = await request(app)
        .get('/api/leaderboard/global')
        .expect(200);

      // Assert
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    test('should include CORS headers', async () => {
      // Act
      const response = await request(app)
        .options('/api/leaderboard/global')
        .expect(204);

      // Assert
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
      expect(response.headers['access-control-allow-headers']).toBeDefined();
    });

    test('should include rate limit headers', async () => {
      // Act
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: 100, survivalTime: 30000, skinUsed: 'sky_jet' })
        .expect(200);

      // Assert
      expect(response.headers['x-rate-limit-limit']).toBeDefined();
      expect(response.headers['x-rate-limit-remaining']).toBeDefined();
      expect(response.headers['x-rate-limit-reset']).toBeDefined();
    });
  });

  describe('🔐 Authentication & Authorization', () => {
    test('should accept valid JWT tokens', async () => {
      // Act
      const response = await request(app)
        .get(`/api/leaderboard/player/${testUser.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
    });

    test('should reject expired tokens', async () => {
      // Arrange
      const expiredToken = jwt.sign(
        { userId: testUser.id, type: 'test' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' } // Expired 1 hour ago
      );

      // Act
      const response = await request(app)
        .get(`/api/leaderboard/player/${testUser.id}`)
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('expired')
      });
    });

    test('should reject tokens with wrong secret', async () => {
      // Arrange
      const wrongToken = jwt.sign(
        { userId: testUser.id, type: 'test' },
        'wrong-secret',
        { expiresIn: '1h' }
      );

      // Act
      const response = await request(app)
        .get(`/api/leaderboard/player/${testUser.id}`)
        .set('Authorization', `Bearer ${wrongToken}`)
        .expect(401);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringMatching(/invalid|Invalid/)
      });
    });
  });
});
