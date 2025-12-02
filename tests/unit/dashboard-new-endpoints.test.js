/**
 * Unit Tests for New Dashboard Endpoints
 * - interstitial-by-trigger
 * - rate-us
 * - achievements
 */

const express = require('express');
const request = require('supertest');

describe('New Dashboard Endpoints', () => {
  let app;
  let db;
  let cacheManager;

  beforeEach(() => {
    // Clear all mocks and module cache
    jest.clearAllMocks();
    jest.resetModules();
    
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
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // INTERSTITIAL BY TRIGGER TESTS
  // ============================================================================

  describe('GET /api/dashboard/interstitial-by-trigger', () => {
    test('should return interstitial ads breakdown by trigger reason', async () => {
      // Mock database responses for the 3 queries
      db.query
        .mockResolvedValueOnce({
          // Total breakdown by trigger_reason
          rows: [
            { trigger_reason: 'win_milestone', shown: '25', unique_users: '15' },
            { trigger_reason: 'loss_streak', shown: '10', unique_users: '8' },
            { trigger_reason: 'unknown', shown: '5', unique_users: '5' }
          ]
        })
        .mockResolvedValueOnce({
          // Daily breakdown
          rows: [
            { date: '2025-12-01', trigger_reason: 'win_milestone', shown: '12' },
            { date: '2025-12-01', trigger_reason: 'loss_streak', shown: '5' },
            { date: '2025-12-02', trigger_reason: 'win_milestone', shown: '13' },
            { date: '2025-12-02', trigger_reason: 'loss_streak', shown: '5' }
          ]
        })
        .mockResolvedValueOnce({
          // Engagement by trigger_reason
          rows: [
            { trigger_reason: 'win_milestone', total_dismissed: '20', clicked: '2', early_dismissed: '3', avg_view_duration_seconds: '8.5' },
            { trigger_reason: 'loss_streak', total_dismissed: '8', clicked: '1', early_dismissed: '2', avg_view_duration_seconds: '6.0' }
          ]
        });

      const response = await request(app)
        .get('/api/dashboard/interstitial-by-trigger')
        .expect(200);

      // Verify structure
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('daily');
      expect(response.body).toHaveProperty('insights');
      expect(response.body).toHaveProperty('days_analyzed');
      expect(response.body).toHaveProperty('last_updated');

      // Verify summary contains trigger reasons
      expect(response.body.summary).toBeInstanceOf(Array);
      expect(response.body.summary.length).toBeGreaterThan(0);
      
      const winMilestone = response.body.summary.find(r => r.trigger_reason === 'win_milestone');
      expect(winMilestone).toBeDefined();
      expect(winMilestone.shown).toBe(25);

      // Verify insights
      expect(response.body.insights).toHaveProperty('total_shown');
      expect(response.body.insights).toHaveProperty('win_milestone_pct');
      expect(response.body.insights).toHaveProperty('loss_streak_pct');
    });

    test('should handle empty data gracefully', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/interstitial-by-trigger')
        .expect(200);

      expect(response.body.summary).toEqual([]);
      expect(response.body.daily).toEqual([]);
      expect(response.body.insights.total_shown).toBe(0);
    });

    test('should respect days parameter', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/interstitial-by-trigger?days=30')
        .expect(200);

      expect(response.body.days_analyzed).toBe(30);
    });
  });

  // ============================================================================
  // RATE US TESTS
  // ============================================================================

  describe('GET /api/dashboard/rate-us', () => {
    test('should return rate us funnel analytics', async () => {
      // Mock database responses
      db.query
        .mockResolvedValueOnce({
          // Funnel stats
          rows: [
            { event_type: 'rate_us_initialized', count: '100', unique_users: '100' },
            { event_type: 'rate_us_popup_shown', count: '50', unique_users: '50' },
            { event_type: 'rate_us_rate_tapped', count: '20', unique_users: '20' },
            { event_type: 'rate_us_completed', count: '15', unique_users: '15' },
            { event_type: 'rate_us_declined', count: '10', unique_users: '10' }
          ]
        })
        .mockResolvedValueOnce({
          // Daily stats
          rows: [
            { date: '2025-12-01', popups_shown: '25', rate_tapped: '10', completed: '8', declined: '5' },
            { date: '2025-12-02', popups_shown: '25', rate_tapped: '10', completed: '7', declined: '5' }
          ]
        })
        .mockResolvedValueOnce({
          // Conversion by session
          rows: [
            { session_count: 3, completions: '5' },
            { session_count: 5, completions: '7' },
            { session_count: 10, completions: '3' }
          ]
        })
        .mockResolvedValueOnce({
          // Decline stats
          rows: [
            { prompt_number: 1, declines: '6' },
            { prompt_number: 2, declines: '4' }
          ]
        });

      const response = await request(app)
        .get('/api/dashboard/rate-us')
        .expect(200);

      // Verify structure
      expect(response.body).toHaveProperty('funnel');
      expect(response.body).toHaveProperty('daily');
      expect(response.body).toHaveProperty('conversion_by_session');
      expect(response.body).toHaveProperty('decline_by_prompt');
      expect(response.body).toHaveProperty('insights');

      // Verify funnel stages
      expect(response.body.funnel).toHaveProperty('initialized');
      expect(response.body.funnel).toHaveProperty('popup_shown');
      expect(response.body.funnel).toHaveProperty('rate_tapped');
      expect(response.body.funnel).toHaveProperty('completed');
      expect(response.body.funnel).toHaveProperty('declined');

      // Verify conversion rates are calculated
      expect(response.body.funnel.popup_shown).toHaveProperty('rate_from_init');
      expect(response.body.funnel.completed).toHaveProperty('overall_conversion');
    });

    test('should calculate conversion rates correctly', async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            { event_type: 'rate_us_initialized', count: '100', unique_users: '100' },
            { event_type: 'rate_us_popup_shown', count: '50', unique_users: '50' },
            { event_type: 'rate_us_completed', count: '10', unique_users: '10' }
          ]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/rate-us')
        .expect(200);

      // 50/100 = 50%
      expect(response.body.funnel.popup_shown.rate_from_init).toBe('50.00%');
      // 10/100 = 10%
      expect(response.body.funnel.completed.overall_conversion).toBe('10.00%');
    });

    test('should handle zero data without division errors', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/rate-us')
        .expect(200);

      expect(response.body.funnel.popup_shown.rate_from_init).toBe('0%');
      expect(response.body.funnel.completed.overall_conversion).toBe('0%');
    });
  });

  // ============================================================================
  // ACHIEVEMENTS TESTS
  // ============================================================================

  describe('GET /api/dashboard/achievements', () => {
    test('should return achievement analytics', async () => {
      // Mock database responses
      db.query
        .mockResolvedValueOnce({
          // Daily unlocks
          rows: [
            { date: '2025-12-01', achievements_unlocked: '20', unique_players: '15' },
            { date: '2025-12-02', achievements_unlocked: '25', unique_players: '18' }
          ]
        })
        .mockResolvedValueOnce({
          // Daily claims
          rows: [
            { date: '2025-12-01', achievements_claimed: '18', unique_claimers: '14', total_coins_rewarded: '1800', total_gems_rewarded: '50' },
            { date: '2025-12-02', achievements_claimed: '22', unique_claimers: '16', total_coins_rewarded: '2200', total_gems_rewarded: '60' }
          ]
        })
        .mockResolvedValueOnce({
          // Top achievements
          rows: [
            { achievement_id: 'first_win', achievement_name: 'First Win', tier: 'bronze', category: 'progress', unlock_count: '100', unique_unlockers: '95' },
            { achievement_id: 'level_master', achievement_name: 'Level Master', tier: 'gold', category: 'levels', unlock_count: '50', unique_unlockers: '48' }
          ]
        })
        .mockResolvedValueOnce({
          // Claim time stats
          rows: [
            { tier: 'bronze', avg_claim_time_seconds: '30', claims: '80' },
            { tier: 'gold', avg_claim_time_seconds: '120', claims: '20' }
          ]
        })
        .mockResolvedValueOnce({
          // Tier breakdown
          rows: [
            { tier: 'bronze', total_unlocks: '100', unique_players: '90', total_claims: '95' },
            { tier: 'gold', total_unlocks: '50', unique_players: '45', total_claims: '48' }
          ]
        });

      const response = await request(app)
        .get('/api/dashboard/achievements')
        .expect(200);

      // Verify structure
      expect(response.body).toHaveProperty('daily_unlocks');
      expect(response.body).toHaveProperty('daily_claims');
      expect(response.body).toHaveProperty('top_achievements');
      expect(response.body).toHaveProperty('claim_time_by_tier');
      expect(response.body).toHaveProperty('tier_breakdown');
      expect(response.body).toHaveProperty('summary');

      // Verify summary
      expect(response.body.summary).toHaveProperty('total_unlocks');
      expect(response.body.summary).toHaveProperty('total_claims');
      expect(response.body.summary).toHaveProperty('claim_rate');
    });

    test('should calculate claim rate correctly', async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [{ date: '2025-12-01', achievements_unlocked: '100', unique_players: '50' }]
        })
        .mockResolvedValueOnce({
          rows: [{ date: '2025-12-01', achievements_claimed: '80', unique_claimers: '45', total_coins_rewarded: '8000', total_gems_rewarded: '200' }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/achievements')
        .expect(200);

      // 80/100 = 80%
      expect(response.body.summary.total_unlocks).toBe(100);
      expect(response.body.summary.total_claims).toBe(80);
      expect(response.body.summary.claim_rate).toBe('80.0');
    });

    test('should return top achievements sorted by unlock count', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { achievement_id: 'top1', achievement_name: 'Top Achievement', tier: 'gold', unlock_count: '500', unique_unlockers: '450' },
            { achievement_id: 'top2', achievement_name: 'Second Best', tier: 'silver', unlock_count: '300', unique_unlockers: '280' }
          ]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/achievements')
        .expect(200);

      expect(response.body.top_achievements).toHaveLength(2);
      expect(response.body.top_achievements[0].achievement_id).toBe('top1');
      expect(response.body.top_achievements[0].unlock_count).toBe('500');
    });

    test('should handle empty data gracefully', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/achievements')
        .expect(200);

      expect(response.body.summary.total_unlocks).toBe(0);
      expect(response.body.summary.total_claims).toBe(0);
      expect(response.body.summary.claim_rate).toBe(0);
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    test('interstitial-by-trigger should handle database errors', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/dashboard/interstitial-by-trigger')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('rate-us should handle database errors', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/dashboard/rate-us')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('achievements should handle database errors', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/dashboard/achievements')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });
  });

  // ============================================================================
  // PARAMETER VALIDATION TESTS
  // ============================================================================

  describe('Parameter Validation', () => {
    test('should cap days parameter at 90', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/interstitial-by-trigger?days=365')
        .expect(200);

      // Should be capped at 90
      expect(response.body.days_analyzed).toBe(90);
    });

    test('should default to 7 days when no parameter provided', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/dashboard/interstitial-by-trigger')
        .expect(200);

      expect(response.body.days_analyzed).toBe(7);
    });
  });
});

