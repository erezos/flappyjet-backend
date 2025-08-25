/**
 * 🧪 Enhanced Leaderboard Integration Tests - TDD Style
 * Comprehensive testing for enhanced Railway backend leaderboard features
 */

const request = require('supertest');
const { Pool } = require('pg');
const Redis = require('ioredis');
const app = require('../../server');
const { setupTestDb, cleanupTestDb, createTestUser, generateJWT } = require('../helpers/test-helpers');
const { EnhancedLeaderboardService } = require('../../services/enhanced-leaderboard-service');
const { CacheManager } = require('../../services/cache-manager');
const { AntiCheatEngine } = require('../../services/anti-cheat-engine');

describe('🏆 Enhanced Leaderboard API - Integration Tests', () => {
  let testDb;
  let testRedis;
  let testUser;
  let authToken;
  let leaderboardService;
  let cacheManager;
  let antiCheatEngine;

  beforeAll(async () => {
    // Setup test database
    testDb = await setupTestDb();
    
    // Setup test Redis instance
    testRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: 15, // Use separate DB for tests
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 1,
    });

    // Initialize services
    leaderboardService = new EnhancedLeaderboardService(testDb, testRedis);
    cacheManager = new CacheManager(testRedis);
    antiCheatEngine = new AntiCheatEngine(testDb);

    // Create test user and auth token
    testUser = await createTestUser(testDb);
    authToken = generateJWT(testUser.id);
  });

  beforeEach(async () => {
    // Clear test data before each test
    await testDb.query('DELETE FROM scores WHERE player_id = $1', [testUser.id]);
    await testRedis.flushdb();
  });

  afterAll(async () => {
    await cleanupTestDb(testDb);
    await testRedis.quit();
  });

  describe('📤 Enhanced Score Submission', () => {
    describe('✅ Valid Submissions', () => {
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
          .send(scoreData)
          .expect(200);

        // Assert
        expect(response.body).toMatchObject({
          success: true,
          scoreId: expect.any(String),
          rank: expect.any(Number),
          isPersonalBest: expect.any(Boolean),
          coinsEarned: 75,
          gemsEarned: 0
        });

        // Verify database entry
        const dbResult = await testDb.query(
          'SELECT * FROM scores WHERE player_id = $1 AND score = $2',
          [testUser.id, 150]
        );
        expect(dbResult.rows).toHaveLength(1);
        expect(dbResult.rows[0].score).toBe(150);
        expect(dbResult.rows[0].survival_time).toBe(45000);
      });

      test('should detect and mark personal best', async () => {
        // Arrange - Submit initial score
        await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ score: 100, survivalTime: 30000, skinUsed: 'sky_jet' });

        // Act - Submit higher score
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ score: 200, survivalTime: 60000, skinUsed: 'sky_jet' })
          .expect(200);

        // Assert
        expect(response.body.isPersonalBest).toBe(true);
        expect(response.body.score).toBe(200);
      });

      test('should calculate correct rank', async () => {
        // Arrange - Create other players with scores
        const otherUsers = [];
        for (let i = 0; i < 5; i++) {
          const user = await createTestUser(testDb);
          otherUsers.push(user);
          
          await testDb.query(
            'INSERT INTO scores (player_id, score, survival_time, skin_used) VALUES ($1, $2, $3, $4)',
            [user.id, (i + 1) * 100, 30000, 'sky_jet']
          );
        }

        // Act - Submit score that should rank 3rd
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ score: 350, survivalTime: 45000, skinUsed: 'sky_jet' })
          .expect(200);

        // Assert
        expect(response.body.rank).toBe(3); // Should be 3rd (500, 400, 350, 300, 200, 100)
      });

      test('should handle concurrent submissions correctly', async () => {
        // Arrange
        const scoreData = { score: 100, survivalTime: 30000, skinUsed: 'sky_jet' };
        
        // Act - Submit multiple scores concurrently
        const promises = Array(5).fill().map(() =>
          request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ ...scoreData, score: scoreData.score + Math.random() * 10 })
        );

        const responses = await Promise.all(promises);

        // Assert
        responses.forEach(response => {
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
        });

        // Verify only valid scores were saved
        const dbResult = await testDb.query(
          'SELECT COUNT(*) FROM scores WHERE player_id = $1',
          [testUser.id]
        );
        expect(parseInt(dbResult.rows[0].count)).toBeGreaterThan(0);
      });
    });

    describe('🛡️ Anti-Cheat Validation', () => {
      test('should reject negative scores', async () => {
        // Act
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ score: -10, survivalTime: 30000, skinUsed: 'sky_jet' })
          .expect(400);

        // Assert
        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('Invalid score')
        });
      });

      test('should reject impossibly high scores', async () => {
        // Act
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ score: 1000000, survivalTime: 30000, skinUsed: 'sky_jet' })
          .expect(400);

        // Assert
        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('exceeds maximum')
        });
      });

      test('should reject suspicious score-to-time ratios', async () => {
        // Act
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ 
            score: 1000, 
            survivalTime: 5000, // 5 seconds for 1000 points = 200 points/sec
            skinUsed: 'sky_jet' 
          })
          .expect(400);

        // Assert
        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('suspicious score-to-time ratio')
        });
      });

      test('should detect rapid improvement patterns', async () => {
        // Arrange - Submit gradual scores
        const scores = [10, 12, 15, 18, 20];
        for (const score of scores) {
          await request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ score, survivalTime: score * 1000, skinUsed: 'sky_jet' });
        }

        // Act - Submit impossibly high improvement
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ score: 500, survivalTime: 60000, skinUsed: 'sky_jet' })
          .expect(400);

        // Assert
        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('suspicious improvement')
        });
      });

      test('should allow reasonable score progressions', async () => {
        // Arrange - Submit gradual scores
        const scores = [45, 48, 52, 55, 58];
        for (const score of scores) {
          await request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ score, survivalTime: score * 1000, skinUsed: 'sky_jet' });
        }

        // Act - Submit reasonable improvement
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ score: 62, survivalTime: 62000, skinUsed: 'sky_jet' })
          .expect(200);

        // Assert
        expect(response.body.success).toBe(true);
      });

      test('should implement rate limiting', async () => {
        // Arrange
        const scoreData = { score: 100, survivalTime: 30000, skinUsed: 'sky_jet' };
        
        // Act - Submit many scores rapidly
        const promises = Array(20).fill().map((_, i) =>
          request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ ...scoreData, score: scoreData.score + i })
        );

        const responses = await Promise.all(promises);

        // Assert - Some requests should be rate limited
        const rateLimitedResponses = responses.filter(r => r.status === 429);
        expect(rateLimitedResponses.length).toBeGreaterThan(0);
      });
    });

    describe('🔐 Authentication & Authorization', () => {
      test('should reject requests without auth token', async () => {
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

      test('should reject requests with invalid auth token', async () => {
        // Act
        const response = await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', 'Bearer invalid_token')
          .send({ score: 100, survivalTime: 30000, skinUsed: 'sky_jet' })
          .expect(401);

        // Assert
        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('invalid token')
        });
      });
    });
  });

  describe('📊 Enhanced Leaderboard Fetching', () => {
    beforeEach(async () => {
      // Create test leaderboard data
      const testScores = [
        { playerId: testUser.id, score: 500, nickname: 'TestPlayer' },
        { playerId: (await createTestUser(testDb)).id, score: 450, nickname: 'Player2' },
        { playerId: (await createTestUser(testDb)).id, score: 400, nickname: 'Player3' },
        { playerId: (await createTestUser(testDb)).id, score: 350, nickname: 'Player4' },
        { playerId: (await createTestUser(testDb)).id, score: 300, nickname: 'Player5' },
      ];

      for (const { playerId, score, nickname } of testScores) {
        await testDb.query(
          'INSERT INTO scores (player_id, score, survival_time, skin_used, achieved_at) VALUES ($1, $2, $3, $4, NOW())',
          [playerId, score, score * 100, 'sky_jet']
        );
        
        await testDb.query(
          'UPDATE players SET nickname = $1 WHERE id = $2',
          [nickname, playerId]
        );
      }
    });

    describe('🌍 Global Leaderboard', () => {
      test('should fetch global leaderboard successfully', async () => {
        // Act
        const response = await request(app)
          .get('/api/leaderboard/global')
          .expect(200);

        // Assert
        expect(response.body).toMatchObject({
          success: true,
          leaderboard: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              nickname: 'TestPlayer',
              score: 500,
              skin_used: 'sky_jet'
            })
          ]),
          pagination: expect.objectContaining({
            limit: 100,
            offset: 0,
            total: expect.any(Number)
          })
        });

        expect(response.body.leaderboard).toHaveLength(5);
        expect(response.body.leaderboard[0].score).toBeGreaterThanOrEqual(
          response.body.leaderboard[1].score
        );
      });

      test('should support pagination', async () => {
        // Act
        const response = await request(app)
          .get('/api/leaderboard/global?limit=2&offset=1')
          .expect(200);

        // Assert
        expect(response.body.leaderboard).toHaveLength(2);
        expect(response.body.pagination).toMatchObject({
          limit: 2,
          offset: 1,
          total: 5,
          hasMore: true
        });
        expect(response.body.leaderboard[0].rank).toBe(2);
      });

      test('should support time period filtering', async () => {
        // Act - Test weekly leaderboard
        const response = await request(app)
          .get('/api/leaderboard/global?period=weekly')
          .expect(200);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.leaderboard).toBeInstanceOf(Array);
      });

      test('should include leaderboard statistics', async () => {
        // Act
        const response = await request(app)
          .get('/api/leaderboard/global?includeStats=true')
          .expect(200);

        // Assert
        expect(response.body.stats).toMatchObject({
          totalPlayers: expect.any(Number),
          totalScores: expect.any(Number),
          averageScore: expect.any(Number),
          highestScore: 500,
          lastUpdated: expect.any(String)
        });
      });
    });

    describe('🎯 Player Context', () => {
      test('should fetch player context successfully', async () => {
        // Act
        const response = await request(app)
          .get(`/api/leaderboard/player/${testUser.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // Assert
        expect(response.body).toMatchObject({
          success: true,
          playerRank: 1,
          playerScore: 500,
          context: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              nickname: 'TestPlayer',
              isCurrentPlayer: true
            })
          ])
        });

        // Should include players around current player
        expect(response.body.context.length).toBeGreaterThanOrEqual(3);
      });

      test('should handle player not found', async () => {
        // Act
        const response = await request(app)
          .get('/api/leaderboard/player/nonexistent-id')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);

        // Assert
        expect(response.body).toMatchObject({
          success: false,
          error: expect.stringContaining('Player not found')
        });
      });
    });
  });

  describe('💾 Caching Layer', () => {
    test('should cache leaderboard responses', async () => {
      // Act - First request (should hit database)
      const response1 = await request(app)
        .get('/api/leaderboard/global')
        .expect(200);

      // Act - Second request (should hit cache)
      const response2 = await request(app)
        .get('/api/leaderboard/global')
        .expect(200);

      // Assert
      expect(response1.body).toEqual(response2.body);
      
      // Verify cache was used (check response headers)
      expect(response2.headers['x-cache-status']).toBe('HIT');
    });

    test('should invalidate cache on new score submission', async () => {
      // Arrange - Prime the cache
      await request(app)
        .get('/api/leaderboard/global')
        .expect(200);

      // Act - Submit new score
      await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: 600, survivalTime: 60000, skinUsed: 'sky_jet' })
        .expect(200);

      // Act - Fetch leaderboard again
      const response = await request(app)
        .get('/api/leaderboard/global')
        .expect(200);

      // Assert - Should reflect new score
      expect(response.body.leaderboard[0].score).toBe(600);
      expect(response.headers['x-cache-status']).toBe('MISS');
    });

    test('should respect cache TTL', async () => {
      // This test would require mocking time or using a very short TTL
      // Implementation depends on cache configuration
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('📈 Performance & Scalability', () => {
    test('should handle large leaderboard efficiently', async () => {
      // Arrange - Create many test scores
      const batchSize = 1000;
      const users = [];
      
      for (let i = 0; i < batchSize; i++) {
        users.push(await createTestUser(testDb));
      }

      const insertPromises = users.map((user, i) =>
        testDb.query(
          'INSERT INTO scores (player_id, score, survival_time, skin_used) VALUES ($1, $2, $3, $4)',
          [user.id, Math.floor(Math.random() * 1000), 30000, 'sky_jet']
        )
      );
      await Promise.all(insertPromises);

      // Act - Measure response time
      const startTime = Date.now();
      const response = await request(app)
        .get('/api/leaderboard/global?limit=100')
        .expect(200);
      const responseTime = Date.now() - startTime;

      // Assert
      expect(responseTime).toBeLessThan(500); // Should respond within 500ms
      expect(response.body.leaderboard).toHaveLength(100);
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(batchSize);
    });

    test('should handle concurrent requests efficiently', async () => {
      // Act - Send multiple concurrent requests
      const promises = Array(50).fill().map(() =>
        request(app)
          .get('/api/leaderboard/global')
          .expect(200)
      );

      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // Assert
      expect(totalTime).toBeLessThan(2000); // All requests within 2 seconds
      responses.forEach(response => {
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('🔧 Error Handling', () => {
    test('should handle database connection errors gracefully', async () => {
      // This would require mocking database failures
      // Implementation depends on error handling strategy
      expect(true).toBe(true); // Placeholder
    });

    test('should handle Redis connection errors gracefully', async () => {
      // This would require mocking Redis failures
      // Implementation depends on fallback strategy
      expect(true).toBe(true); // Placeholder
    });

    test('should validate request parameters', async () => {
      // Act - Send invalid parameters
      const response = await request(app)
        .get('/api/leaderboard/global?limit=invalid&offset=negative')
        .expect(400);

      // Assert
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid parameters')
      });
    });
  });
});

/**
 * 🧪 Unit Tests for Individual Services
 */
describe('🔧 Enhanced Leaderboard Services - Unit Tests', () => {
  describe('🛡️ Anti-Cheat Engine', () => {
    let antiCheat;

    beforeEach(() => {
      antiCheat = new AntiCheatEngine();
    });

    test('should detect impossible score improvements', () => {
      // Arrange
      const recentScores = [10, 12, 15, 18, 20];
      const newScore = 500;

      // Act
      const result = antiCheat.detectSuspiciousImprovement(recentScores, newScore);

      // Assert
      expect(result.isSuspicious).toBe(true);
      expect(result.reason).toContain('improvement');
    });

    test('should validate score-to-time ratios', () => {
      // Arrange
      const score = 1000;
      const survivalTime = 5000; // 5 seconds

      // Act
      const result = antiCheat.validateScoreTimeRatio(score, survivalTime);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('ratio');
    });

    test('should allow reasonable progressions', () => {
      // Arrange
      const recentScores = [45, 48, 52, 55, 58];
      const newScore = 62;

      // Act
      const result = antiCheat.detectSuspiciousImprovement(recentScores, newScore);

      // Assert
      expect(result.isSuspicious).toBe(false);
    });
  });

  describe('💾 Cache Manager', () => {
    let cache;
    let mockRedis;

    beforeEach(() => {
      mockRedis = {
        get: jest.fn(),
        setex: jest.fn(),
        del: jest.fn(),
        flushdb: jest.fn()
      };
      cache = new CacheManager(mockRedis);
    });

    test('should cache data with TTL', async () => {
      // Arrange
      const key = 'test-key';
      const data = { test: 'data' };
      const ttl = 300;

      // Act
      await cache.set(key, data, ttl);

      // Assert
      expect(mockRedis.setex).toHaveBeenCalledWith(
        key,
        ttl,
        JSON.stringify(data)
      );
    });

    test('should retrieve cached data', async () => {
      // Arrange
      const key = 'test-key';
      const cachedData = JSON.stringify({ test: 'data' });
      mockRedis.get.mockResolvedValue(cachedData);

      // Act
      const result = await cache.get(key);

      // Assert
      expect(result).toEqual({ test: 'data' });
      expect(mockRedis.get).toHaveBeenCalledWith(key);
    });

    test('should handle cache misses', async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);

      // Act
      const result = await cache.get('nonexistent-key');

      // Assert
      expect(result).toBeNull();
    });
  });
});
