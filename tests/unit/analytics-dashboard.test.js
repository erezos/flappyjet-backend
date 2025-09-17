/**
 * 📊 Analytics Dashboard Unit Tests
 * Tests for KPI dashboard functionality and data integrity
 */

const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');
const analyticsDashboardRoutes = require('../../routes/analytics-dashboard');
const { setupTestDb, cleanupTestDb, createTestPlayer } = require('../helpers/test-helpers');

describe('Analytics Dashboard API', () => {
  let app;
  let db;
  let testPlayer;
  const validApiKey = 'test-dashboard-key';

  beforeAll(async () => {
    // Setup test environment
    process.env.DASHBOARD_API_KEY = validApiKey;
    
    // Setup test database
    db = await setupTestDb();
    
    // Create Express app with dashboard routes
    app = express();
    app.use(express.json());
    app.use('/api/analytics', analyticsDashboardRoutes);
    
    // Create test player and sample data
    testPlayer = await createTestPlayer(db);
    await createSampleAnalyticsData(db, testPlayer.id);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  describe('Authentication', () => {
    test('should reject requests without API key', async () => {
      const response = await request(app)
        .get('/api/analytics/health');
      
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    test('should reject requests with invalid API key', async () => {
      const response = await request(app)
        .get('/api/analytics/health')
        .set('x-api-key', 'invalid-key');
      
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    test('should accept requests with valid API key in header', async () => {
      const response = await request(app)
        .get('/api/analytics/health')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should accept requests with valid API key in query', async () => {
      const response = await request(app)
        .get(`/api/analytics/health?api_key=${validApiKey}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Health Check Endpoint', () => {
    test('should return healthy status with database info', async () => {
      const response = await request(app)
        .get('/api/analytics/health')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        status: 'healthy',
        database: {
          connected: true
        },
        api_info: {
          version: '1.0.0',
          endpoints: expect.arrayContaining(['/kpi-summary', '/trends', '/retention'])
        }
      });
    });
  });

  describe('KPI Summary Endpoint', () => {
    test('should return KPI summary data', async () => {
      const response = await request(app)
        .get('/api/analytics/kpi-summary')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.meta).toHaveProperty('total_days');
    });

    test('should respect days parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/kpi-summary?days=7')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(7);
    });

    test('should include calculated metrics', async () => {
      const response = await request(app)
        .get('/api/analytics/kpi-summary')
        .set('x-api-key', validApiKey);
      
      if (response.body.data.length > 0) {
        const firstDay = response.body.data[0];
        expect(firstDay).toHaveProperty('crash_rate_per_1000');
        expect(firstDay).toHaveProperty('revenue_per_dau');
        expect(typeof firstDay.crash_rate_per_1000).toBe('number');
        expect(typeof firstDay.revenue_per_dau).toBe('number');
      }
    });
  });

  describe('Trends Endpoint', () => {
    test('should return trends data in ascending order', async () => {
      const response = await request(app)
        .get('/api/analytics/trends')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const data = response.body.data;
      if (data.length > 1) {
        const firstDate = new Date(data[0].date);
        const lastDate = new Date(data[data.length - 1].date);
        expect(firstDate.getTime()).toBeLessThanOrEqual(lastDate.getTime());
      }
    });

    test('should include meta statistics', async () => {
      const response = await request(app)
        .get('/api/analytics/trends')
        .set('x-api-key', validApiKey);
      
      expect(response.body.meta).toHaveProperty('avg_dau');
      expect(response.body.meta).toHaveProperty('avg_revenue');
      expect(typeof response.body.meta.avg_dau).toBe('number');
      expect(typeof response.body.meta.avg_revenue).toBe('number');
    });
  });

  describe('Retention Endpoint', () => {
    test('should return retention cohort data', async () => {
      const response = await request(app)
        .get('/api/analytics/retention')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      if (response.body.data.length > 0) {
        const cohort = response.body.data[0];
        expect(cohort).toHaveProperty('install_date');
        expect(cohort).toHaveProperty('cohort_size');
        expect(cohort).toHaveProperty('day1_retention_rate');
        expect(cohort).toHaveProperty('day7_retention_rate');
        expect(cohort).toHaveProperty('day30_retention_rate');
      }
    });

    test('should include average retention metrics', async () => {
      const response = await request(app)
        .get('/api/analytics/retention')
        .set('x-api-key', validApiKey);
      
      expect(response.body.meta).toHaveProperty('avg_retention');
      expect(response.body.meta.avg_retention).toHaveProperty('day1');
      expect(response.body.meta.avg_retention).toHaveProperty('day7');
      expect(response.body.meta.avg_retention).toHaveProperty('day30');
    });
  });

  describe('Monetization Endpoint', () => {
    test('should return monetization funnel data', async () => {
      const response = await request(app)
        .get('/api/analytics/monetization')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.meta).toHaveProperty('funnel_metrics');
    });

    test('should calculate funnel conversion rates', async () => {
      const response = await request(app)
        .get('/api/analytics/monetization')
        .set('x-api-key', validApiKey);
      
      const funnelMetrics = response.body.meta.funnel_metrics;
      expect(funnelMetrics).toHaveProperty('overall_completion_rate');
      expect(typeof funnelMetrics.overall_completion_rate).toBe('number');
      expect(funnelMetrics.overall_completion_rate).toBeGreaterThanOrEqual(0);
      expect(funnelMetrics.overall_completion_rate).toBeLessThanOrEqual(100);
    });
  });

  describe('Platform Endpoint', () => {
    test('should return platform comparison data', async () => {
      const response = await request(app)
        .get('/api/analytics/platform')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      if (response.body.data.length > 0) {
        const platformData = response.body.data[0];
        expect(platformData).toHaveProperty('android_users');
        expect(platformData).toHaveProperty('ios_users');
        expect(platformData).toHaveProperty('android_percentage');
        expect(platformData).toHaveProperty('ios_percentage');
      }
    });

    test('should include platform summary statistics', async () => {
      const response = await request(app)
        .get('/api/analytics/platform')
        .set('x-api-key', validApiKey);
      
      expect(response.body.meta).toHaveProperty('platform_summary');
      const summary = response.body.meta.platform_summary;
      expect(summary).toHaveProperty('android_share');
      expect(summary).toHaveProperty('ios_share');
    });
  });

  describe('Manual Refresh Endpoint', () => {
    test('should trigger data refresh successfully', async () => {
      const response = await request(app)
        .post('/api/analytics/refresh')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('refreshed successfully');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // Temporarily break the database connection
      const originalQuery = db.query;
      db.query = jest.fn().mockRejectedValue(new Error('Database connection failed'));
      
      const response = await request(app)
        .get('/api/analytics/kpi-summary')
        .set('x-api-key', validApiKey);
      
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch KPI summary');
      
      // Restore original query function
      db.query = originalQuery;
    });

    test('should validate days parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/kpi-summary?days=invalid')
        .set('x-api-key', validApiKey);
      
      // Should default to 30 days and still work
      expect(response.status).toBe(200);
    });
  });
});

/**
 * Helper function to create sample analytics data for testing
 */
async function createSampleAnalyticsData(db, playerId) {
  try {
    // Create sample analytics events
    const sampleEvents = [
      {
        player_id: playerId,
        event_name: 'app_launch',
        event_category: 'engagement',
        parameters: JSON.stringify({ platform: 'android' }),
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000) // Yesterday
      },
      {
        player_id: playerId,
        event_name: 'game_start',
        event_category: 'gameplay',
        parameters: JSON.stringify({ selected_jet: 'sky_jet' }),
        created_at: new Date(Date.now() - 23 * 60 * 60 * 1000)
      },
      {
        player_id: playerId,
        event_name: 'game_end',
        event_category: 'gameplay',
        parameters: JSON.stringify({ final_score: 25, survival_time_seconds: 45 }),
        created_at: new Date(Date.now() - 22 * 60 * 60 * 1000)
      },
      {
        player_id: playerId,
        event_name: 'ad_event',
        event_category: 'monetization',
        parameters: JSON.stringify({ ad_type: 'rewarded', action: 'shown' }),
        created_at: new Date(Date.now() - 21 * 60 * 60 * 1000)
      },
      {
        player_id: playerId,
        event_name: 'ad_event',
        event_category: 'monetization',
        parameters: JSON.stringify({ ad_type: 'rewarded', action: 'completed' }),
        created_at: new Date(Date.now() - 20 * 60 * 60 * 1000)
      }
    ];

    // Insert sample events
    for (const event of sampleEvents) {
      await db.query(`
        INSERT INTO analytics_events (player_id, event_name, event_category, parameters, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [event.player_id, event.event_name, event.event_category, event.parameters, event.created_at]);
    }

    // Create sample purchase
    await db.query(`
      INSERT INTO purchases (player_id, product_id, platform, transaction_id, amount_usd, status, created_at)
      VALUES ($1, 'gem_pack_small', 'android', 'test_txn_123', 2.99, 'completed', $2)
    `, [playerId, new Date(Date.now() - 20 * 60 * 60 * 1000)]);

    console.log('✅ Sample analytics data created for testing');
  } catch (error) {
    console.error('❌ Failed to create sample analytics data:', error);
    throw error;
  }
}
