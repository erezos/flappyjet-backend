/// 🧪 Authentication Routes Unit Tests
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const authRoutes = require('../../routes/auth');

describe('Authentication Routes', () => {
  let app;
  let mockDb;
  let authRouter;

  beforeEach(() => {
    // Create mock database
    mockDb = global.testHelpers.mockDatabase();
    
    // Create Express app with auth routes
    app = express();
    app.use(express.json());
    authRouter = authRoutes(mockDb);
    app.use('/api/auth', authRouter);
    
    // Set test JWT secret
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  describe('POST /api/auth/register', () => {
    it('should register a new player successfully', async () => {
      // Mock database responses
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] }) // No existing player
        .mockResolvedValueOnce({ rows: [{ id: 'test-player-id' }] }) // New player created
        .mockResolvedValueOnce({}) // Starter achievements granted
        .mockResolvedValueOnce({}) // Starter skin granted
        .mockResolvedValueOnce({ // Player data fetch
          rows: [{
            id: 'test-player-id',
            nickname: 'TestPlayer',
            best_score: 0,
            best_streak: 0,
            total_games_played: 0,
            current_coins: 500,
            current_gems: 25,
            current_hearts: 3,
            is_premium: false,
            heart_booster_expiry: null,
            created_at: new Date().toISOString()
          }]
        });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'test-device-123',
          nickname: 'TestPlayer',
          platform: 'ios',
          appVersion: '1.0.0'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.isNewPlayer).toBe(true);
      expect(response.body.token).toBeValidJWT();
      expect(response.body.player).toMatchObject({
        id: 'test-player-id',
        nickname: 'TestPlayer',
        current_coins: 500,
        current_gems: 25
      });
    });

    it('should login existing player', async () => {
      // Mock existing player
      mockDb.mockQuery
        .mockResolvedValueOnce({ // Existing player found
          rows: [{
            id: 'existing-player-id',
            nickname: 'ExistingPlayer',
            created_at: new Date().toISOString()
          }]
        })
        .mockResolvedValueOnce({}) // Update last active
        .mockResolvedValueOnce({ // Player data fetch
          rows: [{
            id: 'existing-player-id',
            nickname: 'ExistingPlayer',
            best_score: 42,
            best_streak: 5,
            total_games_played: 10,
            current_coins: 1000,
            current_gems: 50,
            current_hearts: 3,
            is_premium: false,
            heart_booster_expiry: null,
            created_at: new Date().toISOString()
          }]
        });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'existing-device-123',
          nickname: 'ExistingPlayer',
          platform: 'android'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.isNewPlayer).toBe(false);
      expect(response.body.token).toBeValidJWT();
      expect(response.body.player.id).toBe('existing-player-id');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          nickname: 'TestPlayer'
          // Missing deviceId
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('deviceId');
    });

    it('should handle database errors gracefully', async () => {
      mockDb.mockQuery.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'test-device-123',
          nickname: 'TestPlayer'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Registration failed');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login existing player successfully', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ // Player found
          rows: [{
            id: 'test-player-id',
            nickname: 'TestPlayer',
            best_score: 42,
            best_streak: 5,
            total_games_played: 10,
            current_coins: 1000,
            current_gems: 50,
            current_hearts: 3,
            is_premium: false,
            heart_booster_expiry: null,
            created_at: new Date().toISOString(),
            is_banned: false,
            ban_reason: null
          }]
        })
        .mockResolvedValueOnce({}); // Update last active

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          deviceId: 'test-device-123',
          platform: 'ios'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeValidJWT();
      expect(response.body.player.id).toBe('test-player-id');
    });

    it('should return 404 for non-existent player', async () => {
      mockDb.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          deviceId: 'non-existent-device',
          platform: 'ios'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Player not found. Please register first.');
    });

    it('should return 403 for banned player', async () => {
      mockDb.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'banned-player-id',
          is_banned: true,
          ban_reason: 'Cheating detected'
        }]
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          deviceId: 'banned-device-123',
          platform: 'ios'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Account banned');
      expect(response.body.reason).toBe('Cheating detected');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh valid token successfully', async () => {
      const playerId = 'test-player-id';
      const token = global.testHelpers.generateTestToken(playerId);

      mockDb.mockQuery.mockResolvedValueOnce({
        rows: [{ id: playerId, is_banned: false }]
      });

      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeValidJWT();
      expect(response.body.token).not.toBe(token); // Should be new token
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should reject invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Invalid or expired token');
    });

    it('should reject token for banned player', async () => {
      const playerId = 'banned-player-id';
      const token = global.testHelpers.generateTestToken(playerId);

      mockDb.mockQuery.mockResolvedValueOnce({
        rows: [{ id: playerId, is_banned: true }]
      });

      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Invalid player or account banned');
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should return player profile successfully', async () => {
      const playerId = 'test-player-id';
      const token = global.testHelpers.generateTestToken(playerId);

      mockDb.mockQuery.mockResolvedValueOnce({
        rows: [{
          id: playerId,
          nickname: 'TestPlayer',
          best_score: 42,
          best_streak: 5,
          total_games_played: 10,
          current_coins: 1000,
          current_gems: 50,
          current_hearts: 3,
          is_premium: false,
          heart_booster_expiry: null,
          created_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
          platform: 'ios'
        }]
      });

      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.player).toMatchObject({
        id: playerId,
        nickname: 'TestPlayer',
        best_score: 42,
        current_coins: 1000
      });
    });

    it('should return 404 for non-existent player', async () => {
      const playerId = 'non-existent-player';
      const token = global.testHelpers.generateTestToken(playerId);

      mockDb.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Player not found');
    });
  });

  describe('JWT Token Validation', () => {
    it('should validate JWT token structure', () => {
      const playerId = 'test-player-id';
      const token = global.testHelpers.generateTestToken(playerId);
      
      expect(token).toBeValidJWT();
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.playerId).toBe(playerId);
      expect(decoded.exp).toBeGreaterThan(Date.now() / 1000);
    });

    it('should reject expired tokens', () => {
      const expiredToken = jwt.sign(
        { playerId: 'test-player-id' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' } // Expired 1 hour ago
      );

      expect(() => {
        jwt.verify(expiredToken, process.env.JWT_SECRET);
      }).toThrow('jwt expired');
    });

    it('should reject tokens with wrong secret', () => {
      const wrongSecretToken = jwt.sign(
        { playerId: 'test-player-id' },
        'wrong-secret',
        { expiresIn: '1h' }
      );

      expect(() => {
        jwt.verify(wrongSecretToken, process.env.JWT_SECRET);
      }).toThrow('invalid signature');
    });
  });

  describe('Input Validation', () => {
    it('should validate deviceId length', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'short', // Too short
          nickname: 'TestPlayer'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('deviceId');
    });

    it('should validate nickname length', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'valid-device-id-123',
          nickname: '' // Empty nickname
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('nickname');
    });

    it('should validate platform enum', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'valid-device-id-123',
          nickname: 'TestPlayer',
          platform: 'invalid-platform'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('platform');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send('invalid-json{');

      expect(response.status).toBe(400);
    });

    it('should handle database connection errors', async () => {
      mockDb.mockQuery.mockRejectedValue(new Error('Connection timeout'));

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'test-device-123',
          nickname: 'TestPlayer'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Registration failed');
    });

    it('should handle concurrent registration attempts', async () => {
      // Simulate race condition where player is created between check and insert
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] }) // First check: no player
        .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint')); // Insert fails

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: 'test-device-123',
          nickname: 'TestPlayer'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Registration failed');
    });
  });
});
