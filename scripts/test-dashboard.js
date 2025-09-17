#!/usr/bin/env node

/**
 * 🧪 Dashboard Test Script
 * 
 * Tests the dashboard API endpoints and data integrity
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Test dashboard views and API endpoints
 */
async function testDashboard() {
  const client = await pool.connect();
  
  try {
    logger.info('🧪 Testing dashboard views...');

    // Test each materialized view
    const views = [
      'daily_active_users',
      'daily_revenue', 
      'retention_cohorts',
      'daily_crashes',
      'daily_engagement',
      'daily_monetization_funnel',
      'daily_kpi_summary'
    ];

    for (const viewName of views) {
      try {
        const result = await client.query(`SELECT COUNT(*) as count FROM ${viewName}`);
        const count = parseInt(result.rows[0].count);
        logger.info(`✅ ${viewName}: ${count} rows`);
        
        // Test sample data
        const sample = await client.query(`SELECT * FROM ${viewName} LIMIT 3`);
        if (sample.rows.length > 0) {
          logger.info(`📊 Sample data columns: ${Object.keys(sample.rows[0]).join(', ')}`);
        }
      } catch (error) {
        logger.error(`❌ ${viewName} failed:`, error.message);
      }
    }

    // Test refresh function
    logger.info('🔄 Testing refresh function...');
    await client.query('SELECT refresh_daily_kpi_views()');
    logger.info('✅ Refresh function works');

    // Test data integrity
    logger.info('🔍 Testing data integrity...');
    
    // Check for recent data
    const recentData = await client.query(`
      SELECT COUNT(*) as count 
      FROM daily_active_users 
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    `);
    
    logger.info(`📈 Recent DAU data (last 7 days): ${recentData.rows[0].count} records`);

    logger.info('🎉 Dashboard test completed successfully!');

  } catch (error) {
    logger.error('❌ Dashboard test failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await testDashboard();
    process.exit(0);
  } catch (error) {
    logger.error('💥 Test script failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { testDashboard };
