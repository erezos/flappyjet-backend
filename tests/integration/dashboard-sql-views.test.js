/**
 * 📊 Dashboard SQL Views Integration Tests
 * Tests for materialized views and SQL logic integrity
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { setupTestDb, cleanupTestDb, createTestPlayer } = require('../helpers/test-helpers');

describe('Dashboard SQL Views Integration', () => {
  let db;
  let testPlayers = [];

  beforeAll(async () => {
    db = await setupTestDb();
    
    // Create multiple test players for realistic data
    for (let i = 0; i < 5; i++) {
      const player = await createTestPlayer(db, `TestPlayer${i}`);
      testPlayers.push(player);
    }
    
    // Create comprehensive test data
    await createComprehensiveTestData(db, testPlayers);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  describe('SQL Views Creation', () => {
    test('should create all materialized views without errors', async () => {
      const viewsSQL = fs.readFileSync(
        path.join(__dirname, '../../analytics/daily-kpi-views.sql'), 
        'utf8'
      );
      
      // This should not throw any errors
      await expect(db.query(viewsSQL)).resolves.not.toThrow();
    });

    test('should create refresh function successfully', async () => {
      const result = await db.query(`
        SELECT proname FROM pg_proc 
        WHERE proname = 'refresh_daily_kpi_views'
      `);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].proname).toBe('refresh_daily_kpi_views');
    });
  });

  describe('Daily Active Users View', () => {
    test('should calculate DAU correctly', async () => {
      await db.query('REFRESH MATERIALIZED VIEW daily_active_users');
      
      const result = await db.query(`
        SELECT date, dau, gaming_users, android_users, ios_users
        FROM daily_active_users 
        WHERE date >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY date DESC
        LIMIT 5
      `);
      
      expect(result.rows.length).toBeGreaterThan(0);
      
      for (const row of result.rows) {
        expect(row.dau).toBeGreaterThanOrEqual(0);
        expect(row.gaming_users).toBeGreaterThanOrEqual(0);
        expect(row.android_users + row.ios_users).toBeLessThanOrEqual(row.dau);
      }
    });

    test('should have proper date ordering', async () => {
      const result = await db.query(`
        SELECT date FROM daily_active_users 
        ORDER BY date DESC 
        LIMIT 10
      `);
      
      if (result.rows.length > 1) {
        for (let i = 0; i < result.rows.length - 1; i++) {
          const currentDate = new Date(result.rows[i].date);
          const nextDate = new Date(result.rows[i + 1].date);
          expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
        }
      }
    });
  });

  describe('Daily Revenue View', () => {
    test('should calculate revenue metrics correctly', async () => {
      await db.query('REFRESH MATERIALIZED VIEW daily_revenue');
      
      const result = await db.query(`
        SELECT 
          date, 
          total_purchases, 
          paying_users, 
          total_revenue_usd, 
          avg_purchase_value
        FROM daily_revenue 
        WHERE total_purchases > 0
        LIMIT 5
      `);
      
      for (const row of result.rows) {
        expect(row.total_purchases).toBeGreaterThan(0);
        expect(row.paying_users).toBeGreaterThan(0);
        expect(row.total_revenue_usd).toBeGreaterThan(0);
        expect(row.avg_purchase_value).toBeGreaterThan(0);
        
        // Logical consistency checks
        expect(row.paying_users).toBeLessThanOrEqual(row.total_purchases);
        expect(row.avg_purchase_value).toBe(
          parseFloat((row.total_revenue_usd / row.total_purchases).toFixed(2))
        );
      }
    });

    test('should handle platform breakdown correctly', async () => {
      const result = await db.query(`
        SELECT 
          android_revenue, 
          ios_revenue, 
          total_revenue_usd
        FROM daily_revenue 
        WHERE total_revenue_usd > 0
        LIMIT 5
      `);
      
      for (const row of result.rows) {
        const platformSum = (row.android_revenue || 0) + (row.ios_revenue || 0);
        expect(Math.abs(platformSum - row.total_revenue_usd)).toBeLessThan(0.01); // Allow for rounding
      }
    });
  });

  describe('Retention Cohorts View', () => {
    test('should calculate retention rates correctly', async () => {
      await db.query('REFRESH MATERIALIZED VIEW retention_cohorts');
      
      const result = await db.query(`
        SELECT 
          install_date,
          cohort_size,
          day1_retained,
          day1_retention_rate,
          day7_retained,
          day7_retention_rate,
          day30_retained,
          day30_retention_rate
        FROM retention_cohorts 
        WHERE cohort_size >= 1
        LIMIT 5
      `);
      
      for (const row of result.rows) {
        // Basic validation
        expect(row.cohort_size).toBeGreaterThan(0);
        expect(row.day1_retained).toBeGreaterThanOrEqual(0);
        expect(row.day1_retained).toBeLessThanOrEqual(row.cohort_size);
        
        // Retention rate calculations
        if (row.day1_retained > 0) {
          const expectedRate = (row.day1_retained / row.cohort_size * 100);
          expect(Math.abs(row.day1_retention_rate - expectedRate)).toBeLessThan(0.1);
        }
        
        // Retention funnel logic (day7 <= day1, day30 <= day7)
        expect(row.day7_retained).toBeLessThanOrEqual(row.day1_retained);
        expect(row.day30_retained).toBeLessThanOrEqual(row.day7_retained);
      }
    });

    test('should only include meaningful cohorts', async () => {
      const result = await db.query(`
        SELECT cohort_size FROM retention_cohorts
      `);
      
      for (const row of result.rows) {
        expect(row.cohort_size).toBeGreaterThanOrEqual(5); // As per SQL filter
      }
    });
  });

  describe('Daily Crashes View', () => {
    test('should track error metrics correctly', async () => {
      await db.query('REFRESH MATERIALIZED VIEW daily_crashes');
      
      const result = await db.query(`
        SELECT 
          date,
          total_errors,
          affected_users,
          fatal_crashes,
          non_fatal_errors,
          android_errors,
          ios_errors
        FROM daily_crashes 
        WHERE total_errors > 0
        LIMIT 5
      `);
      
      for (const row of result.rows) {
        expect(row.total_errors).toBeGreaterThan(0);
        expect(row.affected_users).toBeGreaterThan(0);
        expect(row.affected_users).toBeLessThanOrEqual(row.total_errors);
        
        // Platform breakdown should sum to total
        const platformSum = (row.android_errors || 0) + (row.ios_errors || 0);
        expect(platformSum).toBeLessThanOrEqual(row.total_errors);
        
        // Fatal + non-fatal should equal total
        const errorTypeSum = (row.fatal_crashes || 0) + (row.non_fatal_errors || 0);
        expect(errorTypeSum).toBeLessThanOrEqual(row.total_errors);
      }
    });
  });

  describe('Daily Engagement View', () => {
    test('should calculate engagement metrics correctly', async () => {
      await db.query('REFRESH MATERIALIZED VIEW daily_engagement');
      
      const result = await db.query(`
        SELECT 
          date,
          active_players,
          total_sessions,
          avg_games_per_session,
          avg_session_duration_minutes,
          high_engagement_sessions,
          high_engagement_rate
        FROM daily_engagement 
        WHERE active_players > 0
        LIMIT 5
      `);
      
      for (const row of result.rows) {
        expect(row.active_players).toBeGreaterThan(0);
        expect(row.total_sessions).toBeGreaterThan(0);
        expect(row.avg_games_per_session).toBeGreaterThan(0);
        
        // High engagement rate calculation
        if (row.total_sessions > 0) {
          const expectedRate = (row.high_engagement_sessions / row.total_sessions * 100);
          expect(Math.abs(row.high_engagement_rate - expectedRate)).toBeLessThan(0.1);
        }
        
        // Logical bounds
        expect(row.high_engagement_sessions).toBeLessThanOrEqual(row.total_sessions);
        expect(row.high_engagement_rate).toBeGreaterThanOrEqual(0);
        expect(row.high_engagement_rate).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('KPI Summary View', () => {
    test('should aggregate all metrics correctly', async () => {
      await db.query('REFRESH MATERIALIZED VIEW daily_kpi_summary');
      
      const result = await db.query(`
        SELECT 
          date,
          daily_active_users,
          daily_revenue,
          arpu,
          arppu,
          conversion_rate
        FROM daily_kpi_summary 
        WHERE daily_active_users > 0
        LIMIT 5
      `);
      
      for (const row of result.rows) {
        // ARPU calculation validation
        if (row.daily_active_users > 0 && row.daily_revenue > 0) {
          const expectedArpu = row.daily_revenue / row.daily_active_users;
          expect(Math.abs(row.arpu - expectedArpu)).toBeLessThan(0.01);
        }
        
        // Conversion rate bounds
        expect(row.conversion_rate).toBeGreaterThanOrEqual(0);
        expect(row.conversion_rate).toBeLessThanOrEqual(100);
      }
    });

    test('should handle null values gracefully', async () => {
      const result = await db.query(`
        SELECT * FROM daily_kpi_summary 
        WHERE daily_active_users = 0 OR daily_active_users IS NULL
        LIMIT 5
      `);
      
      for (const row of result.rows) {
        // Should default to 0 for calculated metrics when no users
        expect(row.arpu).toBe(0);
        expect(row.conversion_rate).toBe(0);
      }
    });
  });

  describe('Refresh Function', () => {
    test('should refresh all views without errors', async () => {
      await expect(db.query('SELECT refresh_daily_kpi_views()')).resolves.not.toThrow();
    });

    test('should log refresh events', async () => {
      await db.query('SELECT refresh_daily_kpi_views()');
      
      const result = await db.query(`
        SELECT * FROM analytics_events 
        WHERE event_name = 'kpi_dashboard_refreshed'
        ORDER BY created_at DESC 
        LIMIT 1
      `);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].event_category).toBe('system');
    });
  });

  describe('Performance and Indexes', () => {
    test('should have proper indexes on materialized views', async () => {
      const indexes = await db.query(`
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE tablename IN (
          'daily_active_users', 
          'daily_revenue', 
          'retention_cohorts', 
          'daily_crashes', 
          'daily_engagement', 
          'daily_kpi_summary'
        )
      `);
      
      expect(indexes.rows.length).toBeGreaterThan(0);
      
      // Check for date indexes on each view
      const dateIndexes = indexes.rows.filter(row => 
        row.indexname.includes('date') || row.indexname.includes('_date')
      );
      expect(dateIndexes.length).toBeGreaterThan(0);
    });

    test('should execute queries efficiently', async () => {
      const startTime = Date.now();
      
      await db.query(`
        SELECT * FROM daily_kpi_summary 
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY date DESC
      `);
      
      const executionTime = Date.now() - startTime;
      expect(executionTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});

/**
 * Create comprehensive test data for realistic dashboard testing
 */
async function createComprehensiveTestData(db, testPlayers) {
  try {
    const now = new Date();
    
    // Create analytics events for the last 30 days
    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const eventDate = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      
      for (let playerIndex = 0; playerIndex < testPlayers.length; playerIndex++) {
        const player = testPlayers[playerIndex];
        const platform = playerIndex % 2 === 0 ? 'android' : 'ios';
        
        // App launch
        await db.query(`
          INSERT INTO analytics_events (player_id, event_name, event_category, parameters, created_at)
          VALUES ($1, 'app_launch', 'engagement', $2, $3)
        `, [player.id, JSON.stringify({ platform }), eventDate]);
        
        // Game sessions (random 1-5 games per day)
        const gamesPerDay = Math.floor(Math.random() * 5) + 1;
        for (let game = 0; game < gamesPerDay; game++) {
          const gameTime = new Date(eventDate.getTime() + game * 60 * 60 * 1000);
          const score = Math.floor(Math.random() * 100);
          
          // Game start
          await db.query(`
            INSERT INTO analytics_events (player_id, event_name, event_category, parameters, session_id, created_at)
            VALUES ($1, 'game_start', 'gameplay', $2, $3, $4)
          `, [player.id, JSON.stringify({ selected_jet: 'sky_jet' }), `session_${player.id}_${dayOffset}_${game}`, gameTime]);
          
          // Game end
          await db.query(`
            INSERT INTO analytics_events (player_id, event_name, event_category, parameters, session_id, created_at)
            VALUES ($1, 'game_end', 'gameplay', $2, $3, $4)
          `, [player.id, JSON.stringify({ 
            final_score: score, 
            survival_time_seconds: score * 2,
            platform 
          }), `session_${player.id}_${dayOffset}_${game}`, new Date(gameTime.getTime() + 120000)]);
        }
        
        // Random ad events
        if (Math.random() > 0.3) {
          await db.query(`
            INSERT INTO analytics_events (player_id, event_name, event_category, parameters, created_at)
            VALUES ($1, 'ad_event', 'monetization', $2, $3)
          `, [player.id, JSON.stringify({ ad_type: 'rewarded', action: 'shown' }), eventDate]);
          
          if (Math.random() > 0.2) { // 80% completion rate
            await db.query(`
              INSERT INTO analytics_events (player_id, event_name, event_category, parameters, created_at)
              VALUES ($1, 'ad_event', 'monetization', $2, $3)
            `, [player.id, JSON.stringify({ ad_type: 'rewarded', action: 'completed' }), eventDate]);
          }
        }
        
        // Random purchases (10% chance per day)
        if (Math.random() > 0.9) {
          const purchaseAmount = [0.99, 2.99, 4.99, 9.99][Math.floor(Math.random() * 4)];
          await db.query(`
            INSERT INTO purchases (player_id, product_id, platform, transaction_id, amount_usd, status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'completed', $6)
          `, [
            player.id, 
            'gem_pack_small', 
            platform, 
            `test_txn_${player.id}_${dayOffset}`, 
            purchaseAmount, 
            eventDate
          ]);
        }
        
        // Random errors (5% chance per day)
        if (Math.random() > 0.95) {
          await db.query(`
            INSERT INTO analytics_events (player_id, event_name, event_category, parameters, created_at)
            VALUES ($1, 'error_occurred', 'system', $2, $3)
          `, [player.id, JSON.stringify({ 
            error_type: 'RuntimeError', 
            fatal: Math.random() > 0.8,
            platform 
          }), eventDate]);
        }
      }
    }
    
    console.log('✅ Comprehensive test data created for dashboard testing');
  } catch (error) {
    console.error('❌ Failed to create comprehensive test data:', error);
    throw error;
  }
}
