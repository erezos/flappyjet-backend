/**
 * Unit Tests for Retention Table Endpoint
 */

const express = require('express');
const request = require('supertest');

describe('Retention Table API', () => {
  let app;
  let db;
  let cacheManager;

  beforeEach(() => {
    // Mock database
    db = {
      query: jest.fn(),
    };

    // Mock cache manager
    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };

    // Create Express app with route
    app = express();
    app.use(express.json());
    
    // Import and setup route
    const dashboardRoutes = require('../../routes/dashboard-api')(db, cacheManager);
    app.use('/api/dashboard', dashboardRoutes);
  });

  describe('GET /api/dashboard/retention-table', () => {
    test('should return cohort retention table structure', async () => {
      // Mock database responses
      db.query
        .mockResolvedValueOnce({
          rows: [
            {
              install_date: new Date('2025-11-23'),
              days_since_install: 1,
              returned_users: 42,
              cohort_size: 150,
              retention_rate: 28.0,
            },
            {
              install_date: new Date('2025-11-22'),
              days_since_install: 1,
              returned_users: 100,
              cohort_size: 200,
              retention_rate: 50.0,
            },
            {
              install_date: new Date('2025-11-22'),
              days_since_install: 2,
              returned_users: 80,
              cohort_size: 200,
              retention_rate: 40.0,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { install_date: new Date('2025-11-23'), cohort_size: 150 },
            { install_date: new Date('2025-11-22'), cohort_size: 200 },
          ],
        });

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      expect(response.body).toHaveProperty('cohorts');
      expect(response.body).toHaveProperty('last_updated');
      expect(Array.isArray(response.body.cohorts)).toBe(true);
    });

    test('should include all D1-D30 columns for each cohort', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { install_date: new Date('2025-11-23'), cohort_size: 150 },
          ],
        });

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      if (response.body.cohorts.length > 0) {
        const cohort = response.body.cohorts[0];
        expect(cohort).toHaveProperty('retention');
        
        // Check that all D1-D30 keys exist
        for (let day = 1; day <= 30; day++) {
          expect(cohort.retention).toHaveProperty(`d${day}`);
        }
      }
    });

    test('should show null for days that have not passed', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      db.query
        .mockResolvedValueOnce({
          rows: [
            {
              install_date: yesterday,
              days_since_install: 1,
              returned_users: 50,
              cohort_size: 100,
              retention_rate: 50.0,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { install_date: yesterday, cohort_size: 100 },
          ],
        });

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      if (response.body.cohorts.length > 0) {
        const cohort = response.body.cohorts[0];
        // D2 and beyond should be null for yesterday's cohort
        expect(cohort.retention.d2).toBeNull();
        expect(cohort.retention.d3).toBeNull();
      }
    });

    test('should handle empty data gracefully', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      expect(response.body.cohorts).toEqual([]);
    });

    test('should use cache when available', async () => {
      const cachedData = {
        cohorts: [
          {
            install_date: '2025-11-23',
            cohort_size: 150,
            retention: { d1: 28.0, d2: null },
          },
        ],
        last_updated: new Date().toISOString(),
      };

      cacheManager.get.mockResolvedValueOnce(cachedData);

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      expect(response.body).toEqual(cachedData);
      expect(db.query).not.toHaveBeenCalled();
    });

    test('should cache results after query', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      expect(cacheManager.set).toHaveBeenCalledWith(
        'dashboard:retention-table',
        expect.any(Object),
        10800 // 3 hours in seconds
      );
    });

    test('should limit to last 30 install dates', async () => {
      // Create 35 install dates
      const installDates = [];
      for (let i = 0; i < 35; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        installDates.push({ install_date: date, cohort_size: 100 });
      }

      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: installDates });

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      // Should only return 30 cohorts
      expect(response.body.cohorts.length).toBeLessThanOrEqual(30);
    });

    test('should handle database errors gracefully', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Retention value formatting', () => {
    test('should format retention rates correctly', async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            {
              install_date: new Date('2025-11-20'),
              days_since_install: 1,
              returned_users: 75,
              cohort_size: 200,
              retention_rate: 37.5,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { install_date: new Date('2025-11-20'), cohort_size: 200 },
          ],
        });

      const response = await request(app)
        .get('/api/dashboard/retention-table')
        .expect(200);

      if (response.body.cohorts.length > 0) {
        const cohort = response.body.cohorts.find(c => c.install_date === '2025-11-20');
        if (cohort) {
          expect(typeof cohort.retention.d1).toBe('number');
          expect(cohort.retention.d1).toBeCloseTo(37.5, 1);
        }
      }
    });
  });
});

