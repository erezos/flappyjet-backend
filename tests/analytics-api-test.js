// 🧪 Analytics API Test Suite
// Tests the analytics v2 API endpoints with production data
// Created: 2025-01-01

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Test configuration
const TEST_CONFIG = {
  api: {
    baseUrl: 'https://flappyjet-backend-production.up.railway.app',
    apiKey: 'flappyjet-analytics-2024',
  }
};

class AnalyticsAPITestSuite {
  constructor() {
    this.testResults = [];
    this.errors = [];
  }

  // Test 1: KPI Dashboard endpoint
  async testKPIDashboard() {
    console.log('\n🧪 Test 1: KPI Dashboard Endpoint');
    
    try {
      const response = await fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/dashboard/kpis?api_key=${TEST_CONFIG.api.apiKey}&days=7`);
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ KPI Dashboard endpoint working');
        console.log(`  - Status: ${response.status}`);
        console.log(`  - Data points: ${data.data?.length || 0}`);
        console.log(`  - Summary keys: ${Object.keys(data.summary || {}).length}`);
        
        // Check for inflated numbers
        if (data.summary) {
          console.log('📊 Current KPI values:');
          console.log(`  - Total Games: ${data.summary.total_games || 'N/A'}`);
          console.log(`  - Total Revenue: ${data.summary.total_revenue || 'N/A'}`);
          console.log(`  - Average DAU: ${data.summary.avg_dau || 'N/A'}`);
          
          // Flag suspicious values
          if (data.summary.total_games > 1000000) {
            console.log('⚠️  WARNING: Total games seems inflated (>1M)');
          }
          if (data.summary.avg_dau > 100000) {
            console.log('⚠️  WARNING: DAU seems inflated (>100K)');
          }
        }
        
        this.testResults.push({
          test: 'KPI Dashboard',
          status: 'PASS',
          details: {
            status: response.status,
            dataPoints: data.data?.length || 0,
            summaryKeys: Object.keys(data.summary || {}).length,
            totalGames: data.summary?.total_games,
            avgDAU: data.summary?.avg_dau
          }
        });
      } else {
        console.error('❌ KPI Dashboard endpoint failed:', data);
        this.errors.push({ test: 'KPI Dashboard', error: data.error || 'Unknown error' });
      }
    } catch (error) {
      console.error('❌ Test 1 failed:', error.message);
      this.errors.push({ test: 'KPI Dashboard', error: error.message });
    }
  }

  // Test 2: Batch endpoint
  async testBatchEndpoint() {
    console.log('\n🧪 Test 2: Batch Endpoint');
    
    try {
      const testEvent = {
        event_name: 'test_event',
        event_data: { 
          test: true, 
          timestamp: Date.now(),
          source: 'api_test'
        },
        session_id: 'test_session_' + Date.now(),
        user_type: 'test',
        player_id: 'test_player_' + Date.now()
      };

      const response = await fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': TEST_CONFIG.api.apiKey
        },
        body: JSON.stringify({ events: [testEvent] })
      });

      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Batch endpoint working');
        console.log(`  - Status: ${response.status}`);
        console.log(`  - Inserted: ${data.inserted_count}`);
        console.log(`  - Total events: ${data.total_events}`);
        
        this.testResults.push({
          test: 'Batch Endpoint',
          status: 'PASS',
          details: {
            status: response.status,
            inserted: data.inserted_count,
            total: data.total_events
          }
        });
      } else {
        console.error('❌ Batch endpoint failed:', data);
        this.errors.push({ test: 'Batch Endpoint', error: data.error || 'Unknown error' });
      }
    } catch (error) {
      console.error('❌ Test 2 failed:', error.message);
      this.errors.push({ test: 'Batch Endpoint', error: error.message });
    }
  }

  // Test 3: Retention endpoint
  async testRetentionEndpoint() {
    console.log('\n🧪 Test 3: Retention Endpoint');
    
    try {
      const response = await fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/dashboard/retention?api_key=${TEST_CONFIG.api.apiKey}&days=30`);
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Retention endpoint working');
        console.log(`  - Status: ${response.status}`);
        console.log(`  - Cohorts: ${data.data?.length || 0}`);
        
        if (data.meta?.avg_retention) {
          console.log('📊 Average retention rates:');
          console.log(`  - Day 1: ${data.meta.avg_retention.day1?.toFixed(2) || 'N/A'}%`);
          console.log(`  - Day 7: ${data.meta.avg_retention.day7?.toFixed(2) || 'N/A'}%`);
          console.log(`  - Day 30: ${data.meta.avg_retention.day30?.toFixed(2) || 'N/A'}%`);
        }
        
        this.testResults.push({
          test: 'Retention Endpoint',
          status: 'PASS',
          details: {
            status: response.status,
            cohorts: data.data?.length || 0,
            avgRetention: data.meta?.avg_retention
          }
        });
      } else {
        console.error('❌ Retention endpoint failed:', data);
        this.errors.push({ test: 'Retention Endpoint', error: data.error || 'Unknown error' });
      }
    } catch (error) {
      console.error('❌ Test 3 failed:', error.message);
      this.errors.push({ test: 'Retention Endpoint', error: error.message });
    }
  }

  // Test 4: Monetization endpoint
  async testMonetizationEndpoint() {
    console.log('\n🧪 Test 4: Monetization Endpoint');
    
    try {
      const response = await fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/dashboard/monetization?api_key=${TEST_CONFIG.api.apiKey}&days=30`);
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Monetization endpoint working');
        console.log(`  - Status: ${response.status}`);
        console.log(`  - Data points: ${data.data?.length || 0}`);
        
        if (data.meta) {
          console.log('💰 Monetization metrics:');
          console.log(`  - Total Revenue: $${data.meta.total_revenue || 0}`);
          console.log(`  - Total Purchases: ${data.meta.total_purchases || 0}`);
          console.log(`  - Average ARPU: $${data.meta.avg_arpu?.toFixed(4) || 0}`);
          console.log(`  - Ad Completion Rate: ${data.meta.avg_ad_completion_rate?.toFixed(2) || 0}%`);
        }
        
        this.testResults.push({
          test: 'Monetization Endpoint',
          status: 'PASS',
          details: {
            status: response.status,
            dataPoints: data.data?.length || 0,
            totalRevenue: data.meta?.total_revenue,
            totalPurchases: data.meta?.total_purchases,
            avgARPU: data.meta?.avg_arpu
          }
        });
      } else {
        console.error('❌ Monetization endpoint failed:', data);
        this.errors.push({ test: 'Monetization Endpoint', error: data.error || 'Unknown error' });
      }
    } catch (error) {
      console.error('❌ Test 4 failed:', error.message);
      this.errors.push({ test: 'Monetization Endpoint', error: error.message });
    }
  }

  // Test 5: Data consistency check
  async testDataConsistency() {
    console.log('\n🧪 Test 5: Data Consistency Check');
    
    try {
      // Get data for different time periods
      const [day1, day7, day30] = await Promise.all([
        fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/dashboard/kpis?api_key=${TEST_CONFIG.api.apiKey}&days=1`),
        fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/dashboard/kpis?api_key=${TEST_CONFIG.api.apiKey}&days=7`),
        fetch(`${TEST_CONFIG.api.baseUrl}/api/analytics/v2/dashboard/kpis?api_key=${TEST_CONFIG.api.apiKey}&days=30`)
      ]);

      const [day1Data, day7Data, day30Data] = await Promise.all([
        day1.json(),
        day7.json(),
        day30.json()
      ]);

      if (day1.ok && day7.ok && day30.ok) {
        console.log('✅ Data consistency check');
        
        // Check if longer periods have more data
        const day1Games = day1Data.summary?.total_games || 0;
        const day7Games = day7Data.summary?.total_games || 0;
        const day30Games = day30Data.summary?.total_games || 0;
        
        console.log('📊 Games by period:');
        console.log(`  - 1 day: ${day1Games}`);
        console.log(`  - 7 days: ${day7Games}`);
        console.log(`  - 30 days: ${day30Games}`);
        
        // Check consistency
        if (day7Games < day1Games) {
          console.log('⚠️  WARNING: 7-day total is less than 1-day total');
        }
        if (day30Games < day7Games) {
          console.log('⚠️  WARNING: 30-day total is less than 7-day total');
        }
        
        this.testResults.push({
          test: 'Data Consistency',
          status: 'PASS',
          details: {
            day1Games,
            day7Games,
            day30Games,
            consistent: day7Games >= day1Games && day30Games >= day7Games
          }
        });
      } else {
        console.error('❌ Data consistency check failed');
        this.errors.push({ test: 'Data Consistency', error: 'Failed to fetch data for comparison' });
      }
    } catch (error) {
      console.error('❌ Test 5 failed:', error.message);
      this.errors.push({ test: 'Data Consistency', error: error.message });
    }
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting Analytics API Test Suite');
    console.log('====================================');
    
    try {
      await this.testKPIDashboard();
      await this.testBatchEndpoint();
      await this.testRetentionEndpoint();
      await this.testMonetizationEndpoint();
      await this.testDataConsistency();
      
      // Generate test report
      this.generateTestReport();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
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
      'analytics-api-test-report.json',
      JSON.stringify(report, null, 2)
    );
    
    console.log('\n💾 Detailed report saved to: analytics-api-test-report.json');
  }
}

// Run tests if called directly
if (require.main === module) {
  const testSuite = new AnalyticsAPITestSuite();
  testSuite.runAllTests().catch(console.error);
}

module.exports = AnalyticsAPITestSuite;
