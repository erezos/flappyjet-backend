/**
 * Integration Tests for Notification API Routes
 */

const request = require('supertest');
const express = require('express');
const notificationRoutes = require('../../routes/notifications');

// Mock database
const mockDb = {
  query: jest.fn(),
};

// Mock Firebase service
jest.mock('../../services/firebase-messaging-service', () => ({
  initialize: jest.fn().mockResolvedValue(undefined),
  isValidTokenFormat: jest.fn((token) => token && token.length >= 140),
  sendNotification: jest.fn().mockResolvedValue({
    success: true,
    messageId: 'mock-message-id-123',
  }),
}));

describe('Notification API Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationRoutes(mockDb));
    jest.clearAllMocks();
  });

  describe('POST /api/notifications/register-token', () => {
    it('should register a valid FCM token', async () => {
      const validToken = 'a'.repeat(150);
      
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // Deactivate old tokens
        .mockResolvedValueOnce({ 
          rows: [{ id: 1, user_id: 'user123', fcm_token: validToken, is_active: true }] 
        }); // Insert new token

      const response = await request(app)
        .post('/api/notifications/register-token')
        .send({
          userId: 'user123',
          fcmToken: validToken,
          platform: 'android',
          country: 'US',
          timezone: 'America/New_York',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.tokenId).toBe(1);
    });

    it('should reject request without userId', async () => {
      const response = await request(app)
        .post('/api/notifications/register-token')
        .send({
          fcmToken: 'some-token',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('userId and fcmToken are required');
    });

    it('should reject request without fcmToken', async () => {
      const response = await request(app)
        .post('/api/notifications/register-token')
        .send({
          userId: 'user123',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject invalid token format', async () => {
      const response = await request(app)
        .post('/api/notifications/register-token')
        .send({
          userId: 'user123',
          fcmToken: 'short-token', // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid FCM token format');
    });
  });

  describe('POST /api/notifications/clicked', () => {
    it('should track notification click', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Insert click event
        .mockResolvedValueOnce({ rows: [] }); // Update last clicked

      const response = await request(app)
        .post('/api/notifications/clicked')
        .send({
          userId: 'user123',
          notificationType: '1hour',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.eventId).toBe(1);
    });

    it('should reject request without required fields', async () => {
      const response = await request(app)
        .post('/api/notifications/clicked')
        .send({
          userId: 'user123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('notificationType are required');
    });
  });

  describe('POST /api/notifications/claimed', () => {
    it('should mark reward as claimed', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/notifications/claimed')
        .send({
          eventId: 123,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject request without eventId', async () => {
      const response = await request(app)
        .post('/api/notifications/claimed')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('eventId is required');
    });
  });

  describe('GET /api/notifications/history', () => {
    it('should return user notification history', async () => {
      const mockHistory = [
        {
          id: 1,
          notification_type: '1hour',
          event_type: 'sent',
          title: 'Come back!',
          body: 'Your jet is waiting',
          sent_at: new Date(),
        },
      ];

      mockDb.query.mockResolvedValueOnce({ rows: mockHistory });

      const response = await request(app)
        .get('/api/notifications/history?userId=user123&limit=20');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.history).toEqual(mockHistory);
    });

    it('should reject request without userId', async () => {
      const response = await request(app)
        .get('/api/notifications/history');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('userId is required');
    });
  });

  describe('GET /api/notifications/stats', () => {
    it('should return notification statistics', async () => {
      const mockStats = {
        total_sent: 100,
        total_clicked: 25,
        ctr_rate: 25.0,
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockStats] }) // Today stats
        .mockResolvedValueOnce({ rows: [{ active_tokens: 50 }] }) // Token stats
        .mockResolvedValueOnce({ rows: [] }) // Country stats
        .mockResolvedValueOnce({ rows: [] }); // Trend

      const response = await request(app)
        .get('/api/notifications/stats');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.today).toEqual(mockStats);
    });
  });
});

