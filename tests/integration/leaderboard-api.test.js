/**
 * Leaderboard API Integration Tests
 * Tests for the new global leaderboard API endpoints
 */

const request = require('supertest');
const app = require('../../server');
const { setupTestDb, cleanupTestDb, createTestUser, createTestToken } = require('../helpers/test-helpers');

describe('Leaderboard API Integration Tests', () => {
  let testDb;
  let testUser;
  let authToken;

  beforeAll(async () => {
    testDb = await setupTestDb();
    testUser = await createTestUser(testDb);
    authToken = createTestToken(testUser.id);
  });

  afterAll(async () => {
    await cleanupTestDb(testDb);
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await testDb.query('DELETE FROM game_sessions');
    await testDb.query('DELETE FROM players');
  });

  describe('GET /api/leaderboard/global', () => {
    test('should return global leaderboard with top players', async () => {
      // Create test players with scores
      await testDb.query(`
        INSERT INTO players (player_id, player_name, best_score, total_games, jet_skin, theme)
        VALUES 
          ('player1', 'TestPlayer1', 1000, 50, 'jets/green_lightning.png', 'sky'),
          ('player2', 'TestPlayer2', 800, 30, 'jets/red_rocket.png', 'space'),
          ('player3', 'TestPlayer3', 600, 20, 'jets/blue_bolt.png', 'ocean')
      `);

      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.leaderboard).toHaveLength(3);
      expect(response.body.leaderboard[0].playerName).toBe('TestPlayer1');
      expect(response.body.leaderboard[0].score).toBe(1000);
      expect(response.body.leaderboard[0].rank).toBe(1);
      expect(response.body.leaderboard[1].rank).toBe(2);
      expect(response.body.leaderboard[2].rank).toBe(3);
    });

    test('should return user position when requested', async () => {
      // Create test players
      await testDb.query(`
        INSERT INTO players (player_id, player_name, best_score, total_games)
        VALUES 
          ('player1', 'TestPlayer1', 1000, 50),
          ('player2', 'TestPlayer2', 800, 30),
          ('${testUser.id}', '${testUser.name}', 600, 20)
      `);

      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ 
          limit: 2, 
          playerId: testUser.id 
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.leaderboard).toHaveLength(2); // Top 2 players
      expect(response.body.userPosition).toBeTruthy();
      expect(response.body.userPosition.playerId).toBe(testUser.id);
      expect(response.body.userPosition.rank).toBe(3);
    });

    test('should handle pagination correctly', async () => {
      // Create 20 test players
      const players = Array.from({ length: 20 }, (_, i) => 
        `('player${i}', 'TestPlayer${i}', ${1000 - i * 10}, 10)`
      ).join(',');

      await testDb.query(`
        INSERT INTO players (player_id, player_name, best_score, total_games)
        VALUES ${players}
      `);

      // Test first page
      const firstPage = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 5, offset: 0 })
        .expect(200);

      expect(firstPage.body.leaderboard).toHaveLength(5);
      expect(firstPage.body.leaderboard[0].score).toBe(1000);

      // Test second page
      const secondPage = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 5, offset: 5 })
        .expect(200);

      expect(secondPage.body.leaderboard).toHaveLength(5);
      expect(secondPage.body.leaderboard[0].score).toBe(950);
    });

    test('should validate query parameters', async () => {
      await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 150 }) // Over max limit
        .expect(400);

      await request(app)
        .get('/api/leaderboard/global')
        .query({ offset: -1 }) // Negative offset
        .expect(400);

      await request(app)
        .get('/api/leaderboard/global')
        .query({ playerId: 'invalid-uuid' }) // Invalid UUID
        .expect(400);
    });

    test('should return empty leaderboard when no players exist', async () => {
      const response = await request(app)
        .get('/api/leaderboard/global')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.leaderboard).toHaveLength(0);
    });
  });

  describe('GET /api/leaderboard/player/:playerId/scores', () => {
    test('should return player personal scores', async () => {
      // Create player
      await testDb.query(`
        INSERT INTO players (player_id, player_name, best_score, total_games)
        VALUES ('${testUser.id}', '${testUser.name}', 1000, 3)
      `);

      // Create game sessions
      await testDb.query(`
        INSERT INTO game_sessions (player_id, player_name, score, survival_time, jet_skin, theme)
        VALUES 
          ('${testUser.id}', '${testUser.name}', 1000, 120, 'jets/green_lightning.png', 'sky'),
          ('${testUser.id}', '${testUser.name}', 800, 90, 'jets/red_rocket.png', 'space'),
          ('${testUser.id}', '${testUser.name}', 600, 60, 'jets/blue_bolt.png', 'ocean')
      `);

      const response = await request(app)
        .get(`/api/leaderboard/player/${testUser.id}/scores`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.scores).toHaveLength(3);
      expect(response.body.scores[0].rank).toBe(1);
      expect(response.body.scores[0].score).toBe(1000);
      expect(response.body.scores[1].rank).toBe(2);
      expect(response.body.scores[1].score).toBe(800);
    });

    test('should require authentication', async () => {
      await request(app)
        .get(`/api/leaderboard/player/${testUser.id}/scores`)
        .expect(401);
    });

    test('should prevent access to other players scores', async () => {
      const otherUserId = 'other-user-id';
      
      await request(app)
        .get(`/api/leaderboard/player/${otherUserId}/scores`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    test('should validate player ID format', async () => {
      await request(app)
        .get('/api/leaderboard/player/invalid-uuid/scores')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    test('should handle limit parameter', async () => {
      // Create player and sessions
      await testDb.query(`
        INSERT INTO players (player_id, player_name, best_score, total_games)
        VALUES ('${testUser.id}', '${testUser.name}', 1000, 5)
      `);

      const sessions = Array.from({ length: 10 }, (_, i) => 
        `('${testUser.id}', '${testUser.name}', ${1000 - i * 50}, ${120 - i * 10}, 'jets/green_lightning.png', 'sky')`
      ).join(',');

      await testDb.query(`
        INSERT INTO game_sessions (player_id, player_name, score, survival_time, jet_skin, theme)
        VALUES ${sessions}
      `);

      const response = await request(app)
        .get(`/api/leaderboard/player/${testUser.id}/scores`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ limit: 5 })
        .expect(200);

      expect(response.body.scores).toHaveLength(5);
    });
  });

  describe('POST /api/leaderboard/submit', () => {
    test('should submit score successfully', async () => {
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 1000,
          jetSkin: 'jets/green_lightning.png',
          theme: 'sky',
          gameData: { level: 1, powerups: ['shield'] }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.newBest).toBe(true);
      expect(response.body.score).toBe(1000);

      // Verify data was inserted
      const playerResult = await testDb.query(
        'SELECT * FROM players WHERE player_id = $1',
        [testUser.id]
      );
      expect(playerResult.rows[0].best_score).toBe(1000);

      const sessionResult = await testDb.query(
        'SELECT * FROM game_sessions WHERE player_id = $1',
        [testUser.id]
      );
      expect(sessionResult.rows).toHaveLength(1);
      expect(sessionResult.rows[0].score).toBe(1000);
    });

    test('should require authentication', async () => {
      await request(app)
        .post('/api/leaderboard/submit')
        .send({ score: 1000 })
        .expect(401);
    });

    test('should validate score parameter', async () => {
      await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: -100 })
        .expect(400);

      await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({}) // Missing score
        .expect(400);

      await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: 'invalid' })
        .expect(400);
    });

    test('should handle multiple score submissions', async () => {
      // Submit first score
      await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: 800 })
        .expect(200);

      // Submit higher score
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: 1000 })
        .expect(200);

      expect(response.body.newBest).toBe(true);

      // Submit lower score
      const lowerResponse = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: 600 })
        .expect(200);

      expect(lowerResponse.body.newBest).toBe(false);

      // Verify best score is still 1000
      const playerResult = await testDb.query(
        'SELECT best_score FROM players WHERE player_id = $1',
        [testUser.id]
      );
      expect(playerResult.rows[0].best_score).toBe(1000);
    });
  });

  describe('PUT /api/leaderboard/player/:playerId/nickname', () => {
    beforeEach(async () => {
      // Create test player
      await testDb.query(`
        INSERT INTO players (player_id, player_name, best_score, total_games)
        VALUES ('${testUser.id}', '${testUser.name}', 1000, 10)
      `);

      // Create some game sessions
      await testDb.query(`
        INSERT INTO game_sessions (player_id, player_name, score)
        VALUES 
          ('${testUser.id}', '${testUser.name}', 1000),
          ('${testUser.id}', '${testUser.name}', 800)
      `);
    });

    test('should update player nickname successfully', async () => {
      const newNickname = 'UpdatedNickname';

      const response = await request(app)
        .put(`/api/leaderboard/player/${testUser.id}/nickname`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ nickname: newNickname })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Nickname updated successfully');

      // Verify player table was updated
      const playerResult = await testDb.query(
        'SELECT player_name FROM players WHERE player_id = $1',
        [testUser.id]
      );
      expect(playerResult.rows[0].player_name).toBe(newNickname);

      // Verify recent game sessions were updated
      const sessionResult = await testDb.query(
        'SELECT DISTINCT player_name FROM game_sessions WHERE player_id = $1',
        [testUser.id]
      );
      expect(sessionResult.rows[0].player_name).toBe(newNickname);
    });

    test('should require authentication', async () => {
      await request(app)
        .put(`/api/leaderboard/player/${testUser.id}/nickname`)
        .send({ nickname: 'NewName' })
        .expect(401);
    });

    test('should prevent updating other players nicknames', async () => {
      const otherUserId = 'other-user-id';
      
      await request(app)
        .put(`/api/leaderboard/player/${otherUserId}/nickname`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ nickname: 'NewName' })
        .expect(403);
    });

    test('should validate nickname parameter', async () => {
      // Empty nickname
      await request(app)
        .put(`/api/leaderboard/player/${testUser.id}/nickname`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ nickname: '' })
        .expect(400);

      // Too long nickname
      await request(app)
        .put(`/api/leaderboard/player/${testUser.id}/nickname`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ nickname: 'a'.repeat(51) })
        .expect(400);

      // Missing nickname
      await request(app)
        .put(`/api/leaderboard/player/${testUser.id}/nickname`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);
    });

    test('should validate player ID format', async () => {
      await request(app)
        .put('/api/leaderboard/player/invalid-uuid/nickname')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ nickname: 'NewName' })
        .expect(400);
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits on score submission', async () => {
      const requests = [];
      
      // Make 51 requests (over the limit of 50 per minute)
      for (let i = 0; i < 51; i++) {
        requests.push(
          request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ score: 100 + i })
        );
      }

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    test('should enforce rate limits on nickname updates', async () => {
      const requests = [];
      
      // Make 11 requests (over the limit of 10 per minute)
      for (let i = 0; i < 11; i++) {
        requests.push(
          request(app)
            .put(`/api/leaderboard/player/${testUser.id}/nickname`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({ nickname: `Name${i}` })
        );
      }

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });
});
