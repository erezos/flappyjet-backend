#!/usr/bin/env node

/**
 * 🔄 Dashboard Views Refresh Script
 * 
 * Refreshes all materialized views for the Daily KPI Dashboard
 * Runs twice daily via cron job
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Refresh all dashboard materialized views
 */
async function refreshDashboardViews() {
  const client = await pool.connect();
  
  try {
    logger.info('🔄 Starting dashboard views refresh...');
    const startTime = Date.now();

    // Call the refresh function we created in the SQL
    await client.query('SELECT refresh_daily_kpi_views();');
    
    const duration = Date.now() - startTime;
    logger.info(`✅ Dashboard views refreshed successfully in ${duration}ms`);
    
    // Log view statistics
    const stats = await client.query(`
      SELECT 
        'daily_active_users' as view_name,
        COUNT(*) as row_count
      FROM daily_active_users
      UNION ALL
      SELECT 
        'daily_revenue' as view_name,
        COUNT(*) as row_count
      FROM daily_revenue
      UNION ALL
      SELECT 
        'retention_cohorts' as view_name,
        COUNT(*) as row_count
      FROM retention_cohorts
      UNION ALL
      SELECT 
        'daily_crashes' as view_name,
        COUNT(*) as row_count
      FROM daily_crashes
      UNION ALL
      SELECT 
        'daily_engagement' as view_name,
        COUNT(*) as row_count
      FROM daily_engagement
      UNION ALL
      SELECT 
        'daily_monetization_funnel' as view_name,
        COUNT(*) as row_count
      FROM daily_monetization_funnel
      UNION ALL
      SELECT 
        'daily_kpi_summary' as view_name,
        COUNT(*) as row_count
      FROM daily_kpi_summary
      ORDER BY view_name;
    `);

    logger.info('📊 View statistics after refresh:');
    stats.rows.forEach(row => {
      logger.info(`  ${row.view_name}: ${row.row_count} rows`);
    });

  } catch (error) {
    logger.error('❌ Dashboard views refresh failed:', error);
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
    await refreshDashboardViews();
    process.exit(0);
  } catch (error) {
    logger.error('💥 Refresh script failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { refreshDashboardViews };
