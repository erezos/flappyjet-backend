/// 🧪 API Integration Tests - End-to-end testing with real database
const request = require('supertest');
const app = require('../../server');

describe('API Integration Tests', () => {
  let testPlayer;
  let authToken;
  let testScore;

  beforeEach(async () => {
    // Create test player for integration tests
    if (global.testConfig.dbPool) {
      testPlayer = await global.testHelpers.createTestPlayer({
        nickname: 'IntegrationTestPlayer',
        device_id: `integration_test_${Date.now()}`
      });
    }
  });

  describe('Complete User Flow', () => {
    it('should complete full user registration and gameplay flow', async () => {
      const deviceId = `integration_device_${Date.now()}`;
      
      // 1. Register new player
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId,
          nickname: 'FlowTestPlayer',
          platform: 'ios',
          appVersion: '1.0.0'
        });

      expect(registerResponse.status).toBe(200);
      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.isNewPlayer).toBe(true);
      expect(registerResponse.body.token).toBeValidJWT();
      
      const playerId = registerResponse.body.player.id;
      authToken = registerResponse.body.token;

      // 2. Get player profile
      const profileResponse = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.player.id).toBe(playerId);
      expect(profileResponse.body.player.nickname).toBe('FlowTestPlayer');

      // 3. Get daily missions
      const missionsResponse = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(missionsResponse.status).toBe(200);
      expect(missionsResponse.body.success).toBe(true);
      expect(missionsResponse.body.missions).toHaveLength(4); // 4 daily missions
      
      const playGamesMission = missionsResponse.body.missions.find(
        m => m.mission_type === 'play_games'
      );
      expect(playGamesMission).toBeDefined();

      // 4. Submit first game score
      const scoreResponse1 = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 15,
          survivalTime: 20,
          skinUsed: 'sky_jet',
          coinsEarned: 8,
          gemsEarned: 1,
          gameDuration: 20000
        });

      expect(scoreResponse1.status).toBe(200);
      expect(scoreResponse1.body.success).toBe(true);
      expect(scoreResponse1.body.rank).toBeGreaterThan(0);

      // 5. Check mission progress after first game
      const missionsAfterGame1 = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      const updatedPlayGamesMission = missionsAfterGame1.body.missions.find(
        m => m.mission_type === 'play_games'
      );
      expect(updatedPlayGamesMission.progress).toBe(1);

      // 6. Submit second game score (higher)
      const scoreResponse2 = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 25,
          survivalTime: 30,
          skinUsed: 'sky_jet',
          coinsEarned: 12,
          gemsEarned: 2,
          gameDuration: 30000
        });

      expect(scoreResponse2.status).toBe(200);
      expect(scoreResponse2.body.isPersonalBest).toBe(true);

      // 7. Check global leaderboard
      const leaderboardResponse = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 10, playerId });

      expect(leaderboardResponse.status).toBe(200);
      expect(leaderboardResponse.body.success).toBe(true);
      
      const playerEntry = leaderboardResponse.body.leaderboard.find(
        entry => entry.player_id === playerId
      );
      expect(playerEntry).toBeDefined();
      expect(playerEntry.score).toBe(25);
      expect(playerEntry.is_current_player).toBe(true);

      // 8. Get player rank
      const rankResponse = await request(app)
        .get(`/api/leaderboard/player/${playerId}`);

      expect(rankResponse.status).toBe(200);
      expect(rankResponse.body.success).toBe(true);
      expect(rankResponse.body.player.score).toBe(25);

      // 9. Login with existing device (should return existing player)
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          deviceId,
          platform: 'ios'
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.player.id).toBe(playerId);
      expect(loginResponse.body.player.best_score).toBe(25);
    });

    it('should handle mission completion and rewards', async () => {
      if (!global.testConfig.dbPool) {
        console.log('🧪 Skipping database integration test (no DB connection)');
        return;
      }

      const deviceId = `mission_test_${Date.now()}`;
      
      // Register player
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId,
          nickname: 'MissionTestPlayer',
          platform: 'android'
        });

      authToken = registerResponse.body.token;
      const playerId = registerResponse.body.player.id;

      // Get initial missions
      const initialMissions = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      const playGamesMission = initialMissions.body.missions.find(
        m => m.mission_type === 'play_games'
      );
      
      const requiredGames = playGamesMission.target;
      const missionReward = playGamesMission.reward;

      // Get initial coin balance
      const initialProfile = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`);
      
      const initialCoins = initialProfile.body.player.current_coins;

      // Play enough games to complete the mission
      for (let i = 0; i < requiredGames; i++) {
        await request(app)
          .post('/api/leaderboard/submit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            score: 10 + i,
            survivalTime: 15 + i,
            skinUsed: 'sky_jet',
            coinsEarned: 5,
            gemsEarned: 0,
            gameDuration: 15000 + i * 1000
          });
      }

      // Check mission completion
      const completedMissions = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      const completedPlayGamesMission = completedMissions.body.missions.find(
        m => m.mission_type === 'play_games'
      );

      expect(completedPlayGamesMission.completed).toBe(true);
      expect(completedPlayGamesMission.progress).toBe(requiredGames);

      // Check that coins were awarded
      const finalProfile = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`);

      const finalCoins = finalProfile.body.player.current_coins;
      const expectedCoins = initialCoins + (5 * requiredGames) + missionReward; // Game coins + mission reward

      expect(finalCoins).toBe(expectedCoins);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle invalid authentication gracefully', async () => {
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          score: 42,
          survivalTime: 30,
          gameDuration: 30000
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Invalid or expired token');
    });

    it('should handle malformed requests', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send('invalid-json');

      expect(response.status).toBe(400);
    });

    it('should handle missing required fields', async () => {
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${global.testHelpers.generateTestToken('test-id')}`)
        .send({
          // Missing required fields
          survivalTime: 30
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Performance Integration', () => {
    it('should handle rapid requests without errors', async () => {
      if (!global.testConfig.dbPool) {
        console.log('🧪 Skipping performance test (no DB connection)');
        return;
      }

      const deviceId = `perf_test_${Date.now()}`;
      
      // Register player
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId,
          nickname: 'PerfTestPlayer'
        });

      authToken = registerResponse.body.token;

      // Submit multiple scores rapidly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              score: 10 + i,
              survivalTime: 15 + i,
              gameDuration: 15000 + i * 1000
            })
        );
      }

      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    it('should respond within acceptable time limits', async () => {
      const start = Date.now();
      
      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 50 });

      const duration = Date.now() - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(5000); // Should respond within 5 seconds
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across operations', async () => {
      if (!global.testConfig.dbPool) {
        console.log('🧪 Skipping consistency test (no DB connection)');
        return;
      }

      const deviceId = `consistency_test_${Date.now()}`;
      
      // Register player
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId,
          nickname: 'ConsistencyTestPlayer'
        });

      authToken = registerResponse.body.token;
      const playerId = registerResponse.body.player.id;

      // Submit score
      await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          score: 50,
          survivalTime: 40,
          coinsEarned: 20,
          gemsEarned: 3,
          gameDuration: 40000
        });

      // Check that all related data was updated consistently
      const profileResponse = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(profileResponse.body.player.best_score).toBe(50);
      expect(profileResponse.body.player.total_games_played).toBe(1);
      expect(profileResponse.body.player.current_coins).toBe(520); // 500 initial + 20 earned

      // Check leaderboard reflects the score
      const leaderboardResponse = await request(app)
        .get('/api/leaderboard/global');

      const playerEntry = leaderboardResponse.body.leaderboard.find(
        entry => entry.player_id === playerId
      );

      expect(playerEntry).toBeDefined();
      expect(playerEntry.score).toBe(50);
    });
  });

  describe('Security Integration', () => {
    it('should prevent SQL injection attempts', async () => {
      const maliciousDeviceId = "'; DROP TABLE players; --";
      
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: maliciousDeviceId,
          nickname: 'HackerPlayer'
        });

      // Should either succeed (if properly sanitized) or fail with validation error
      // Should NOT crash the server or execute the SQL injection
      expect([200, 400]).toContain(response.status);
      
      // Verify players table still exists by making another request
      const testResponse = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: `safe_device_${Date.now()}`,
          nickname: 'SafePlayer'
        });

      expect(testResponse.status).toBe(200);
    });

    it('should rate limit excessive requests', async () => {
      // Make many requests rapidly to trigger rate limiting
      const promises = [];
      for (let i = 0; i < 150; i++) { // Exceed the 100 requests/minute limit
        promises.push(
          request(app)
            .get('/health')
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429 status)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Health Check Integration', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toHaveValidTimestamp();
      expect(response.body.version).toBe('1.0.0');
    });

    it('should return API documentation on root', async () => {
      const response = await request(app)
        .get('/');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('FlappyJet Pro Backend API');
      expect(response.body.endpoints).toBeDefined();
    });
  });
});
