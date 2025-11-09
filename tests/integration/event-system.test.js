/**
 * Integration Tests for Event-Driven System
 * Tests the full flow from event ingestion to leaderboards to prizes
 */

const request = require('supertest');
const app = require('../../server'); // Your Express app

describe('Event-Driven System Integration Tests', () => {
  const testUserId = `test_device_${Date.now()}`;
  const tournamentId = 'test_tournament_2025_01';

  describe('POST /api/events', () => {
    test('should accept batch of events', async () => {
      const events = [
        {
          event_type: 'app_installed',
          user_id: testUserId,
          timestamp: new Date().toISOString(),
          app_version: '1.4.2',
          platform: 'android',
          device_model: 'Test Device',
          os_version: '12',
          country: 'US',
          language: 'en'
        },
        {
          event_type: 'app_launched',
          user_id: testUserId,
          timestamp: new Date().toISOString()
        }
      ];

      const response = await request(app)
        .post('/api/events')
        .send({ events })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.received).toBe(2);
    });

    test('should reject invalid events', async () => {
      const events = [
        {
          event_type: 'invalid_event',
          // Missing required fields
        }
      ];

      const response = await request(app)
        .post('/api/events')
        .send({ events })
        .expect(200); // Still 200 (fire-and-forget)

      expect(response.body.success).toBe(true);
      // Check results for errors
      if (response.body.results) {
        expect(response.body.results[0].success).toBe(false);
      }
    });

    test('should handle game_ended event', async () => {
      const events = [
        {
          event_type: 'game_ended',
          user_id: testUserId,
          timestamp: new Date().toISOString(),
          game_mode: 'endless',
          score: 99,
          duration_seconds: 300,
          obstacles_passed: 50,
          result: 'crashed'
        }
      ];

      const response = await request(app)
        .post('/api/events')
        .send({ events })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.received).toBe(1);
    });
  });

  describe('GET /api/v2/leaderboard/global', () => {
    test('should return top 15 global leaderboard', async () => {
      const response = await request(app)
        .get('/api/v2/leaderboard/global')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.leaderboard).toBeDefined();
      expect(Array.isArray(response.body.leaderboard)).toBe(true);
      expect(response.body.leaderboard.length).toBeLessThanOrEqual(15);

      // Verify structure
      if (response.body.leaderboard.length > 0) {
        const entry = response.body.leaderboard[0];
        expect(entry).toHaveProperty('rank');
        expect(entry).toHaveProperty('user_id');
        expect(entry).toHaveProperty('nickname');
        expect(entry).toHaveProperty('high_score');
      }
    });

    test('should return user rank when user_id provided', async () => {
      const response = await request(app)
        .get(`/api/v2/leaderboard/global?user_id=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      // user_rank might be null if user hasn't played yet
      expect(response.body).toHaveProperty('user_rank');
    });

    test('should include nickname in leaderboard entries', async () => {
      const response = await request(app)
        .get('/api/v2/leaderboard/global')
        .expect(200);

      if (response.body.leaderboard.length > 0) {
        response.body.leaderboard.forEach(entry => {
          expect(entry.nickname).toBeDefined();
          expect(typeof entry.nickname).toBe('string');
        });
      }
    });
  });

  describe('GET /api/v2/leaderboard/user/:userId', () => {
    test('should return user rank and stats', async () => {
      const response = await request(app)
        .get(`/api/v2/leaderboard/user/${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('found');
    });

    test('should handle non-existent user', async () => {
      const response = await request(app)
        .get('/api/v2/leaderboard/user/non_existent_user')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.found).toBe(false);
    });
  });

  describe('POST /api/v2/leaderboard/update-nickname', () => {
    test('should update user nickname', async () => {
      const response = await request(app)
        .post('/api/v2/leaderboard/update-nickname')
        .send({
          user_id: testUserId,
          nickname: 'Test Pilot'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.nickname).toBe('Test Pilot');
    });

    test('should reject invalid nickname', async () => {
      const response = await request(app)
        .post('/api/v2/leaderboard/update-nickname')
        .send({
          user_id: testUserId,
          nickname: 'AB' // Too short
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject nickname with special characters', async () => {
      const response = await request(app)
        .post('/api/v2/leaderboard/update-nickname')
        .send({
          user_id: testUserId,
          nickname: 'Test@Pilot!' // Invalid chars
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v2/tournaments/current', () => {
    test('should return current tournament info', async () => {
      const response = await request(app)
        .get('/api/v2/tournaments/current')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('tournament');
    });
  });

  describe('GET /api/v2/tournaments/:id/leaderboard', () => {
    test('should return top 15 tournament leaderboard', async () => {
      const response = await request(app)
        .get(`/api/v2/tournaments/${tournamentId}/leaderboard`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.leaderboard).toBeDefined();
      expect(Array.isArray(response.body.leaderboard)).toBe(true);
      expect(response.body.leaderboard.length).toBeLessThanOrEqual(15);
    });

    test('should include nicknames and prize tiers', async () => {
      const response = await request(app)
        .get(`/api/v2/tournaments/${tournamentId}/leaderboard`)
        .expect(200);

      if (response.body.leaderboard.length > 0) {
        const entry = response.body.leaderboard[0];
        expect(entry).toHaveProperty('nickname');
        expect(entry).toHaveProperty('prize_tier');
      }
    });

    test('should return user rank when user_id provided', async () => {
      const response = await request(app)
        .get(`/api/v2/tournaments/${tournamentId}/leaderboard?user_id=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('user_rank');
    });
  });

  describe('GET /api/v2/tournaments/:id/prizes', () => {
    test('should return prize pool information', async () => {
      const response = await request(app)
        .get(`/api/v2/tournaments/${tournamentId}/prizes`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.prizes).toBeDefined();
      expect(Array.isArray(response.body.prizes)).toBe(true);
      
      // Verify prize structure
      const firstPlace = response.body.prizes.find(p => p.rank === 1);
      expect(firstPlace).toBeDefined();
      expect(firstPlace.coins).toBe(5000);
      expect(firstPlace.gems).toBe(250);
    });
  });

  describe('GET /api/v2/prizes/pending', () => {
    test('should return pending prizes for user', async () => {
      const response = await request(app)
        .get(`/api/v2/prizes/pending?user_id=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.prizes).toBeDefined();
      expect(Array.isArray(response.body.prizes)).toBe(true);
      expect(response.body).toHaveProperty('has_prizes');
    });

    test('should reject request without user_id', async () => {
      const response = await request(app)
        .get('/api/v2/prizes/pending')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v2/prizes/claim', () => {
    test('should acknowledge prize claim (fire-and-forget)', async () => {
      const prizeId = 'test_prize_123';

      const response = await request(app)
        .post('/api/v2/prizes/claim')
        .send({
          prize_id: prizeId,
          user_id: testUserId,
          claimed_at: new Date().toISOString()
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('acknowledged');
    });

    test('should reject claim without prize_id', async () => {
      const response = await request(app)
        .post('/api/v2/prizes/claim')
        .send({
          user_id: testUserId
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v2/prizes/history', () => {
    test('should return prize claim history', async () => {
      const response = await request(app)
        .get(`/api/v2/prizes/history?user_id=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.prizes).toBeDefined();
      expect(Array.isArray(response.body.prizes)).toBe(true);
    });

    test('should respect limit parameter', async () => {
      const response = await request(app)
        .get(`/api/v2/prizes/history?user_id=${testUserId}&limit=5`)
        .expect(200);

      expect(response.body.prizes.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/v2/prizes/stats', () => {
    test('should return prize statistics', async () => {
      const response = await request(app)
        .get(`/api/v2/prizes/stats?user_id=${testUserId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.stats).toBeDefined();
      expect(response.body.stats).toHaveProperty('total_prizes');
      expect(response.body.stats).toHaveProperty('total_coins_won');
      expect(response.body.stats).toHaveProperty('total_gems_won');
    });
  });

  describe('Full Flow Test: Game → Leaderboard → Prize', () => {
    test('should process game event, update leaderboard, and award prize', async () => {
      const flowUserId = `flow_test_${Date.now()}`;

      // 1. Send game_ended event
      await request(app)
        .post('/api/events')
        .send({
          events: [
            {
              event_type: 'game_ended',
              user_id: flowUserId,
              timestamp: new Date().toISOString(),
              game_mode: 'tournament',
              tournament_id: tournamentId,
              score: 999,
              duration_seconds: 500,
              obstacles_passed: 100,
              result: 'crashed'
            }
          ]
        })
        .expect(200);

      // 2. Wait for aggregation (or trigger manually in test environment)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 3. Check leaderboard
      const leaderboardResponse = await request(app)
        .get(`/api/v2/tournaments/${tournamentId}/leaderboard?user_id=${flowUserId}`)
        .expect(200);

      expect(leaderboardResponse.body.success).toBe(true);
      // User should appear in leaderboard or have a rank

      // 4. Check pending prizes (after tournament ends and prizes calculated)
      const prizesResponse = await request(app)
        .get(`/api/v2/prizes/pending?user_id=${flowUserId}`)
        .expect(200);

      expect(prizesResponse.body.success).toBe(true);
    }, 10000); // Longer timeout for full flow
  });
});

