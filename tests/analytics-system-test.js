// 🧪 Analytics System Test Suite
// Comprehensive testing for analytics v2 system with production data validation
// Created: 2025-01-01

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// Test configuration
const TEST_CONFIG = {
  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/flappyjet_test',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  },
  api: {
    baseUrl: process.env.RAILWAY_URL || 'https://flappyjet-backend-production.up.railway.app',
    apiKey: process.env.DASHBOARD_API_KEY || 'flappyjet-analytics-2024',
  }
};

class AnalyticsTestSuite {
  constructor() {
    this.db = null;
    this.testResults = [];
    this.errors = [];
  }

  async initialize() {
    try {
      this.db = new Pool(TEST_CONFIG.database);
      await this.db.query('SELECT 1'); // Test connection
      console.log('✅ Database connection established');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      console.log('💡 Make sure DATABASE_URL environment variable is set for Railway production database');
      throw error;
    }
  }

  async cleanup() {
    if (this.db) {
      await this.db.end();
      console.log('✅ Database connection closed');
    }
  }

  // Test 1: Validate current analytics data structure
  async testCurrentDataStructure() {
    console.log('\n🧪 Test 1: Current Analytics Data Structure');
    
    try {
      // Check analytics_events_v2 table structure
      const tableInfo = await this.db.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'analytics_events_v2'
        ORDER BY ordinal_position
      `);
      
      console.log('📊 analytics_events_v2 table structure:');
      tableInfo.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });

      // Check current data volume
      const dataVolume = await this.db.query(`
        SELECT 
          COUNT(*) as total_events,
          COUNT(DISTINCT player_id) as unique_players,
          COUNT(DISTINCT session_id) as unique_sessions,
          MIN(created_at) as earliest_event,
          MAX(created_at) as latest_event
        FROM analytics_events_v2
      `);

      console.log('📈 Current data volume:');
      console.log(`  - Total events: ${dataVolume.rows[0].total_events}`);
      console.log(`  - Unique players: ${dataVolume.rows[0].unique_players}`);
      console.log(`  - Unique sessions: ${dataVolume.rows[0].unique_sessions}`);
      console.log(`  - Date range: ${dataVolume.rows[0].earliest_event} to ${dataVolume.rows[0].latest_event}`);

      // Check event types distribution
      const eventTypes = await this.db.query(`
        SELECT 
          event_name,
          COUNT(*) as count,
          COUNT(DISTINCT player_id) as unique_players
        FROM analytics_events_v2
        GROUP BY event_name
        ORDER BY count DESC
        LIMIT 20
      `);

      console.log('🎯 Top event types:');
      eventTypes.rows.forEach(event => {
        console.log(`  - ${event.event_name}: ${event.count} events, ${event.unique_players} players`);
      });

      this.testResults.push({
        test: 'Current Data Structure',
        status: 'PASS',
        details: {
          totalEvents: dataVolume.rows[0].total_events,
          uniquePlayers: dataVolume.rows[0].unique_players,
          uniqueSessions: dataVolume.rows[0].unique_sessions,
          eventTypes: eventTypes.rows.length
        }
      });

    } catch (error) {
      console.error('❌ Test 1 failed:', error.message);
      this.errors.push({ test: 'Current Data Structure', error: error.message });
    }
  }

  // Test 2: Validate current KPI calculations
  async testCurrentKPICalculations() {
    console.log('\n🧪 Test 2: Current KPI Calculations');
    
    try {
      // Test current DAU calculation
      const currentDAU = await this.db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(DISTINCT player_id) as dau_current,
          COUNT(DISTINCT CASE WHEN player_id IS NOT NULL THEN player_id END) as dau_authenticated_only,
          COUNT(DISTINCT CASE WHEN player_id IS NULL THEN session_id END) as anonymous_sessions
        FROM analytics_events_v2
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 7
      `);

      console.log('📊 Current DAU calculation (last 7 days):');
      currentDAU.rows.forEach(row => {
        console.log(`  - ${row.date}: ${row.dau_current} total, ${row.dau_authenticated_only} authenticated, ${row.anonymous_sessions} anonymous sessions`);
      });

      // Test current game counting
      const currentGames = await this.db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) as total_game_starts,
          COUNT(DISTINCT CASE WHEN event_name = 'game_start' THEN session_id END) as unique_game_sessions,
          COUNT(DISTINCT CASE WHEN event_name = 'game_start' THEN player_id END) as players_who_played
        FROM analytics_events_v2
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 7
      `);

      console.log('🎮 Current game counting (last 7 days):');
      currentGames.rows.forEach(row => {
        console.log(`  - ${row.date}: ${row.total_game_starts} game_starts, ${row.unique_game_sessions} unique sessions, ${row.players_who_played} players`);
      });

      // Test session tracking
      const sessionTracking = await this.db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(DISTINCT session_id) as unique_sessions,
          COUNT(CASE WHEN event_name = 'session_start' THEN 1 END) as session_start_events,
          COUNT(CASE WHEN event_name = 'session_end' THEN 1 END) as session_end_events
        FROM analytics_events_v2
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 7
      `);

      console.log('🔄 Session tracking (last 7 days):');
      sessionTracking.rows.forEach(row => {
        console.log(`  - ${row.date}: ${row.unique_sessions} unique sessions, ${row.session_start_events} starts, ${row.session_end_events} ends`);
      });

      this.testResults.push({
        test: 'Current KPI Calculations',
        status: 'PASS',
        details: {
          dauData: currentDAU.rows,
          gameData: currentGames.rows,
          sessionData: sessionTracking.rows
        }
      });

    } catch (error) {
      console.error('❌ Test 2 failed:', error.message);
      this.errors.push({ test: 'Current KPI Calculations', error: error.message });
    }
  }

  // Test 3: Identify data quality issues
  async testDataQualityIssues() {
    console.log('\n🧪 Test 3: Data Quality Issues');
    
    try {
      // Check for duplicate events
      const duplicates = await this.db.query(`
        SELECT 
          event_name,
          player_id,
          session_id,
          DATE(created_at) as date,
          COUNT(*) as duplicate_count
        FROM analytics_events_v2
        GROUP BY event_name, player_id, session_id, DATE(created_at)
        HAVING COUNT(*) > 1
        ORDER BY duplicate_count DESC
        LIMIT 20
      `);

      console.log('🔄 Duplicate events found:');
      if (duplicates.rows.length > 0) {
        duplicates.rows.forEach(dup => {
          console.log(`  - ${dup.event_name}: ${dup.duplicate_count} duplicates for player ${dup.player_id} on ${dup.date}`);
        });
      } else {
        console.log('  ✅ No duplicate events found');
      }

      // Check for missing player_id in critical events
      const missingPlayerId = await this.db.query(`
        SELECT 
          event_name,
          COUNT(*) as count,
          COUNT(CASE WHEN player_id IS NULL THEN 1 END) as missing_player_id
        FROM analytics_events_v2
        WHERE event_name IN ('game_start', 'game_end', 'session_start', 'iap_purchase')
        GROUP BY event_name
        ORDER BY count DESC
      `);

      console.log('👤 Missing player_id in critical events:');
      missingPlayerId.rows.forEach(row => {
        const percentage = ((row.missing_player_id / row.count) * 100).toFixed(1);
        console.log(`  - ${row.event_name}: ${row.missing_player_id}/${row.count} (${percentage}%) missing player_id`);
      });

      // Check for session_id consistency
      const sessionConsistency = await this.db.query(`
        SELECT 
          COUNT(DISTINCT session_id) as unique_sessions,
          COUNT(CASE WHEN session_id IS NULL THEN 1 END) as null_sessions,
          COUNT(CASE WHEN session_id = '' THEN 1 END) as empty_sessions
        FROM analytics_events_v2
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      `);

      console.log('🔄 Session ID consistency:');
      console.log(`  - Unique sessions: ${sessionConsistency.rows[0].unique_sessions}`);
      console.log(`  - Null sessions: ${sessionConsistency.rows[0].null_sessions}`);
      console.log(`  - Empty sessions: ${sessionConsistency.rows[0].empty_sessions}`);

      this.testResults.push({
        test: 'Data Quality Issues',
        status: 'PASS',
        details: {
          duplicates: duplicates.rows.length,
          missingPlayerId: missingPlayerId.rows,
          sessionConsistency: sessionConsistency.rows[0]
        }
      });

    } catch (error) {
      console.error('❌ Test 3 failed:', error.message);
      this.errors.push({ test: 'Data Quality Issues', error: error.message });
    }
  }

  // Test 4: Validate API endpoints
  async testAPIEndpoints() {
    console.log('\n🧪 Test 4: API Endpoints');
    
    try {
      const fetch = require('node-fetch');
      
      // Test KPI dashboard endpoint
      const kpiResponse = await fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/dashboard/kpis?api_key=${TEST_CONFIG.api.apiKey}&days=7`);
      const kpiData = await kpiResponse.json();
      
      if (kpiResponse.ok) {
        console.log('✅ KPI Dashboard endpoint working');
        console.log(`  - Status: ${kpiResponse.status}`);
        console.log(`  - Data points: ${kpiData.data?.length || 0}`);
        console.log(`  - Summary keys: ${Object.keys(kpiData.summary || {}).length}`);
      } else {
        console.error('❌ KPI Dashboard endpoint failed:', kpiData);
      }

      // Test batch endpoint
      const testEvent = {
        event_name: 'test_event',
        event_data: { test: true, timestamp: Date.now() },
        session_id: 'test_session_' + Date.now(),
        user_type: 'test',
        player_id: 'test_player_' + Date.now()
      };

      const batchResponse = await fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': TEST_CONFIG.api.apiKey
        },
        body: JSON.stringify({ events: [testEvent] })
      });

      const batchData = await batchResponse.json();
      
      if (batchResponse.ok) {
        console.log('✅ Batch endpoint working');
        console.log(`  - Status: ${batchResponse.status}`);
        console.log(`  - Inserted: ${batchData.inserted_count}`);
      } else {
        console.error('❌ Batch endpoint failed:', batchData);
      }

      this.testResults.push({
        test: 'API Endpoints',
        status: batchResponse.ok && kpiResponse.ok ? 'PASS' : 'FAIL',
        details: {
          kpiStatus: kpiResponse.status,
          batchStatus: batchResponse.status,
          kpiData: kpiData.data?.length || 0,
          batchInserted: batchData.inserted_count || 0
        }
      });

    } catch (error) {
      console.error('❌ Test 4 failed:', error.message);
      this.errors.push({ test: 'API Endpoints', error: error.message });
    }
  }

  // Test 5: Performance analysis
  async testPerformanceAnalysis() {
    console.log('\n🧪 Test 5: Performance Analysis');
    
    try {
      // Test query performance for KPI calculations
      const startTime = Date.now();
      
      const kpiQuery = await this.db.query(`
        WITH daily_metrics AS (
          SELECT 
            DATE(created_at) as date,
            COUNT(DISTINCT player_id) as dau,
            COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) as total_games,
            COUNT(DISTINCT session_id) as total_sessions
          FROM analytics_events_v2
          WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY DATE(created_at)
        )
        SELECT 
          date,
          dau,
          total_games,
          total_sessions
        FROM daily_metrics
        ORDER BY date DESC
        LIMIT 30
      `);
      
      const queryTime = Date.now() - startTime;
      
      console.log(`⏱️ KPI query performance: ${queryTime}ms`);
      console.log(`  - Rows returned: ${kpiQuery.rows.length}`);
      console.log(`  - Average time per row: ${(queryTime / kpiQuery.rows.length).toFixed(2)}ms`);

      // Test table size and indexing
      const tableStats = await this.db.query(`
        SELECT 
          schemaname,
          tablename,
          attname,
          n_distinct,
          correlation
        FROM pg_stats
        WHERE tablename = 'analytics_events_v2'
        ORDER BY n_distinct DESC
      `);

      console.log('📊 Table statistics:');
      tableStats.rows.forEach(stat => {
        console.log(`  - ${stat.attname}: ${stat.n_distinct} distinct values, correlation: ${stat.correlation}`);
      });

      this.testResults.push({
        test: 'Performance Analysis',
        status: 'PASS',
        details: {
          queryTime: queryTime,
          rowsReturned: kpiQuery.rows.length,
          tableStats: tableStats.rows.length
        }
      });

    } catch (error) {
      console.error('❌ Test 5 failed:', error.message);
      this.errors.push({ test: 'Performance Analysis', error: error.message });
    }
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting Analytics System Test Suite');
    console.log('=====================================');
    
    await this.initialize();
    
    try {
      await this.testCurrentDataStructure();
      await this.testCurrentKPICalculations();
      await this.testDataQualityIssues();
      await this.testAPIEndpoints();
      await this.testPerformanceAnalysis();
      
      // Generate test report
      this.generateTestReport();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
    } finally {
      await this.cleanup();
    }
  }

  // Generate comprehensive test report
  generateTestReport() {
    console.log('\n📋 Test Report Summary');
    console.log('=====================');
    
    const passedTests = this.testResults.filter(t => t.status === 'PASS').length;
    const totalTests = this.testResults.length;
    
    console.log(`✅ Tests passed: ${passedTests}/${totalTests}`);
    console.log(`❌ Tests failed: ${this.errors.length}`);
    
    if (this.errors.length > 0) {
      console.log('\n❌ Failed tests:');
      this.errors.forEach(error => {
        console.log(`  - ${error.test}: ${error.error}`);
      });
    }
    
    console.log('\n📊 Test results:');
    this.testResults.forEach(result => {
      console.log(`  - ${result.test}: ${result.status}`);
    });
    
    // Save detailed report to file
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: totalTests,
        passedTests: passedTests,
        failedTests: this.errors.length,
        successRate: `${((passedTests / totalTests) * 100).toFixed(1)}%`
      },
      results: this.testResults,
      errors: this.errors
    };
    
    require('fs').writeFileSync(
      'analytics-test-report.json',
      JSON.stringify(report, null, 2)
    );
    
    console.log('\n💾 Detailed report saved to: analytics-test-report.json');
  }
}

// Run tests if called directly
if (require.main === module) {
  const testSuite = new AnalyticsTestSuite();
  testSuite.runAllTests().catch(console.error);
}

module.exports = AnalyticsTestSuite;
