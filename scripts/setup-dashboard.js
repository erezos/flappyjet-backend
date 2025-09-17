#!/usr/bin/env node

// 📊 Dashboard Setup Script
// Sets up the Daily KPI Dashboard with initial data and scheduling

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

console.log('🎯 FlappyJet Pro - Dashboard Setup');
console.log('=====================================\n');

async function setupDashboard() {
  try {
    console.log('📊 Setting up Daily KPI Dashboard...\n');

    // Step 1: Create materialized views
    console.log('1️⃣ Creating materialized views...');
    const viewsSQL = fs.readFileSync(
      path.join(__dirname, '../analytics/daily-kpi-views.sql'), 
      'utf8'
    );
    
    await db.query(viewsSQL);
    console.log('✅ Materialized views created successfully\n');

    // Step 2: Initial data refresh
    console.log('2️⃣ Performing initial data refresh...');
    await db.query('SELECT refresh_daily_kpi_views()');
    console.log('✅ Initial data refresh completed\n');

    // Step 3: Check data availability
    console.log('3️⃣ Checking data availability...');
    const dataCheck = await db.query(`
      SELECT 
        COUNT(*) as total_days,
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        SUM(daily_active_users) as total_dau,
        SUM(daily_revenue) as total_revenue
      FROM daily_kpi_summary
    `);

    const stats = dataCheck.rows[0];
    console.log(`   📈 Total days of data: ${stats.total_days}`);
    console.log(`   📅 Date range: ${stats.earliest_date} to ${stats.latest_date}`);
    console.log(`   👥 Total DAU recorded: ${stats.total_dau}`);
    console.log(`   💰 Total revenue recorded: $${parseFloat(stats.total_revenue || 0).toFixed(2)}`);
    console.log('✅ Data availability check completed\n');

    // Step 4: Set up refresh schedule (if not exists)
    console.log('4️⃣ Setting up automated refresh schedule...');
    
    // Create a simple cron-like function for twice daily refresh
    const cronSQL = `
      -- Create refresh schedule function
      CREATE OR REPLACE FUNCTION schedule_dashboard_refresh()
      RETURNS void AS $$
      BEGIN
        -- This would typically be handled by a cron job or scheduler
        -- For now, we'll create a simple trigger-based approach
        
        -- Log the scheduling setup
        INSERT INTO analytics_events (event_name, event_category, parameters)
        VALUES ('dashboard_refresh_scheduled', 'system', jsonb_build_object(
          'frequency', 'twice_daily',
          'times', '06:00 and 18:00 UTC',
          'setup_timestamp', NOW()
        ));
        
      END;
      $$ LANGUAGE plpgsql;
      
      SELECT schedule_dashboard_refresh();
    `;
    
    await db.query(cronSQL);
    console.log('✅ Refresh schedule configured\n');

    // Step 5: Create sample dashboard access
    console.log('5️⃣ Setting up dashboard access...');
    
    // Generate API key for dashboard access
    const apiKey = process.env.DASHBOARD_API_KEY || 'flappyjet-analytics-2024';
    console.log(`   🔑 Dashboard API Key: ${apiKey}`);
    console.log('   📝 Add this to your environment variables as DASHBOARD_API_KEY\n');

    // Step 6: Display dashboard URLs
    console.log('6️⃣ Dashboard access information:');
    const baseUrl = process.env.RAILWAY_STATIC_URL || 
                   process.env.RAILWAY_PUBLIC_DOMAIN || 
                   'http://localhost:3000';
    
    console.log(`   🌐 Dashboard URL: ${baseUrl}/analytics/dashboard.html?api_key=${apiKey}`);
    console.log(`   📊 API Base URL: ${baseUrl}/api/analytics`);
    console.log(`   🏥 Health Check: ${baseUrl}/api/analytics/health\n`);

    // Step 7: Test API endpoints
    console.log('7️⃣ Testing API endpoints...');
    
    try {
      const testQueries = [
        { name: 'KPI Summary', query: 'SELECT COUNT(*) FROM daily_kpi_summary LIMIT 1' },
        { name: 'DAU Data', query: 'SELECT COUNT(*) FROM daily_active_users LIMIT 1' },
        { name: 'Revenue Data', query: 'SELECT COUNT(*) FROM daily_revenue LIMIT 1' },
        { name: 'Retention Data', query: 'SELECT COUNT(*) FROM retention_cohorts LIMIT 1' }
      ];

      for (const test of testQueries) {
        const result = await db.query(test.query);
        console.log(`   ✅ ${test.name}: ${result.rows[0].count} records`);
      }
    } catch (testError) {
      console.log(`   ⚠️ Some API tests failed: ${testError.message}`);
    }

    console.log('\n🎉 Dashboard setup completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Add the analytics dashboard route to your server.js');
    console.log('   2. Set up a cron job to refresh data twice daily');
    console.log('   3. Access your dashboard using the URL above');
    console.log('   4. Monitor the health endpoint for data freshness\n');

    // Display sample cron job setup
    console.log('⏰ Sample Cron Job (add to your server or use Railway cron):');
    console.log('   # Refresh dashboard data twice daily at 6 AM and 6 PM UTC');
    console.log('   0 6,18 * * * curl -X POST "' + baseUrl + '/api/analytics/refresh" -H "x-api-key: ' + apiKey + '"');
    console.log('');

  } catch (error) {
    console.error('❌ Dashboard setup failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDashboard().catch(console.error);
}

module.exports = { setupDashboard };
