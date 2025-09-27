/**
 * Anonymous Flow Integration Tests
 * Tests the complete anonymous user flow for FlappyJet
 */

const request = require('supertest');
const { Pool } = require('pg');

// Test configuration
const TEST_CONFIG = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
  dbUrl: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  testDeviceId: 'test_device_anonymous_flow_12345',
  testPlayerName: 'Anonymous Test Player',
};

// Database connection for test verification
const pool = new Pool({
  connectionString: TEST_CONFIG.dbUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

describe('Anonymous Flow Integration Tests', () => {
  let anonymousPlayerId;

  beforeAll(async () => {
    // Clean up any existing test data
    await cleanupTestData();
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
    await pool.end();
  });

  describe('Anonymous Score Submission', () => {
    test('Should submit anonymous score successfully', async () => {
      const scoreData = {
        deviceId: TEST_CONFIG.testDeviceId,
        playerName: TEST_CONFIG.testPlayerName,
        score: 150,
        platform: 'test',
        appVersion: '1.0.0',
        countryCode: 'US',
        jetSkin: 'jets/sky_jet.png',
        theme: 'sky',
        gameData: {
          survivalTime: 45,
          continuesUsed: 0,
          sessionLength: 45,
        }
      };

      const response = await request(TEST_CONFIG.baseUrl)
        .post('/api/leaderboard/submit-anonymous')
        .send(scoreData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.anonymous).toBe(true);
      expect(response.body.playerId).toBe(`anon_${TEST_CONFIG.testDeviceId}`);
      
      anonymousPlayerId = response.body.playerId;

      // Verify database entry
      const dbResult = await pool.query(
        'SELECT * FROM players WHERE player_id = $1',
        [anonymousPlayerId]
      );

      expect(dbResult.rows.length).toBe(1);
      const player = dbResult.rows[0];
      expect(player.is_anonymous).toBe(true);
      expect(player.device_id).toBe(TEST_CONFIG.testDeviceId);
      expect(player.best_score).toBe(150);
      expect(player.total_games).toBe(1);
    });

    test('Should update existing anonymous player on second score', async () => {
      const scoreData = {
        deviceId: TEST_CONFIG.testDeviceId,
        playerName: TEST_CONFIG.testPlayerName,
        score: 200, // Higher score
        platform: 'test',
        appVersion: '1.0.0',
        countryCode: 'US',
        jetSkin: 'jets/sky_jet.png',
        theme: 'sky',
        gameData: {
          survivalTime: 60,
          continuesUsed: 1,
          sessionLength: 60,
        }
      };

      const response = await request(TEST_CONFIG.baseUrl)
        .post('/api/leaderboard/submit-anonymous')
        .send(scoreData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.newBest).toBe(true);

      // Verify database update
      const dbResult = await pool.query(
        'SELECT * FROM players WHERE player_id = $1',
        [anonymousPlayerId]
      );

      const player = dbResult.rows[0];
      expect(player.best_score).toBe(200); // Updated best score
      expect(player.total_games).toBe(2); // Incremented games count
    });

    test('Should reject invalid anonymous score submission', async () => {
      const invalidData = {
        // Missing required deviceId
        playerName: TEST_CONFIG.testPlayerName,
        score: 100,
      };

      await request(TEST_CONFIG.baseUrl)
        .post('/api/leaderboard/submit-anonymous')
        .send(invalidData)
        .expect(400);
    });
  });

  describe('Anonymous Analytics', () => {
    test('Should record anonymous analytics event', async () => {
      const eventData = {
        eventName: 'game_start',
        eventCategory: 'gameplay',
        parameters: {
          theme: 'sky',
          jetSkin: 'jets/sky_jet.png',
          gameMode: 'normal',
        },
        sessionId: 'test_session_123',
        deviceId: TEST_CONFIG.testDeviceId,
        platform: 'test',
        appVersion: '1.0.0',
      };

      const response = await request(TEST_CONFIG.baseUrl)
        .post('/api/analytics/anonymous-event')
        .send(eventData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.playerId).toBe(`anon_${TEST_CONFIG.testDeviceId}`);

      // Verify analytics event in database
      const dbResult = await pool.query(
        'SELECT * FROM analytics_events WHERE player_id = $1 AND event_name = $2',
        [anonymousPlayerId, 'game_start']
      );

      expect(dbResult.rows.length).toBe(1);
      const event = dbResult.rows[0];
      expect(event.event_category).toBe('gameplay');
      expect(event.platform).toBe('test');
    });

    test('Should process anonymous analytics batch', async () => {
      const batchData = {
        events: [
          {
            eventName: 'game_end',
            eventCategory: 'gameplay',
            parameters: { score: 150, survivalTime: 45 },
          },
          {
            eventName: 'feature_usage',
            eventCategory: 'engagement',
            parameters: { feature: 'pause_menu' },
          },
        ],
        deviceId: TEST_CONFIG.testDeviceId,
        sessionId: 'test_session_batch_123',
        platform: 'test',
        appVersion: '1.0.0',
      };

      const response = await request(TEST_CONFIG.baseUrl)
        .post('/api/analytics/anonymous-batch')
        .send(batchData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.processed.total).toBe(2);
      expect(response.body.processed.success).toBe(2);
      expect(response.body.processed.errors).toBe(0);

      // Verify both events in database
      const dbResult = await pool.query(
        'SELECT * FROM analytics_events WHERE player_id = $1 AND event_name IN ($2, $3)',
        [anonymousPlayerId, 'game_end', 'feature_usage']
      );

      expect(dbResult.rows.length).toBe(2);
    });
  });

  describe('Anonymous User Analytics Views', () => {
    test('Should include anonymous user in analytics views', async () => {
      // Check anonymous user stats view
      const anonymousStatsResult = await pool.query('SELECT * FROM anonymous_user_stats');
      expect(anonymousStatsResult.rows.length).toBe(1);
      
      const stats = anonymousStatsResult.rows[0];
      expect(stats.total_anonymous_users).toBeGreaterThan(0);

      // Check auth conversion stats view
      const conversionStatsResult = await pool.query('SELECT * FROM auth_conversion_stats');
      expect(conversionStatsResult.rows.length).toBe(1);
      
      const conversionStats = conversionStatsResult.rows[0];
      expect(conversionStats.anonymous_users).toBeGreaterThan(0);
      expect(conversionStats.total_users).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting', () => {
    test('Should apply rate limiting to anonymous submissions', async () => {
      const scoreData = {
        deviceId: 'rate_limit_test_device',
        playerName: 'Rate Limit Test',
        score: 100,
        platform: 'test',
        appVersion: '1.0.0',
      };

      // Make multiple rapid requests
      const promises = Array(25).fill().map(() => 
        request(TEST_CONFIG.baseUrl)
          .post('/api/leaderboard/submit-anonymous')
          .send(scoreData)
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429 status)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  // Helper function to clean up test data
  async function cleanupTestData() {
    try {
      // Clean up players
      await pool.query(
        'DELETE FROM players WHERE device_id = $1 OR device_id = $2',
        [TEST_CONFIG.testDeviceId, 'rate_limit_test_device']
      );

      // Clean up analytics events
      await pool.query(
        'DELETE FROM analytics_events WHERE player_id LIKE $1 OR player_id LIKE $2',
        [`anon_${TEST_CONFIG.testDeviceId}`, 'anon_rate_limit_test_device']
      );

      // Clean up game sessions
      await pool.query(
        'DELETE FROM game_sessions WHERE player_id LIKE $1 OR player_id LIKE $2',
        [`anon_${TEST_CONFIG.testDeviceId}`, 'anon_rate_limit_test_device']
      );

      console.log('🧹 Test data cleaned up');
    } catch (error) {
      console.warn('⚠️ Error during test cleanup:', error.message);
    }
  }
});

// Export for use in other test files
module.exports = {
  TEST_CONFIG,
  pool,
};
