#!/usr/bin/env node

/**
 * 🔄 Analytics Materialized Views Refresh Script
 * 
 * Refreshes all analytics materialized views:
 * - daily_aggregations (refreshed daily)
 * - cohort_aggregations (refreshed daily)
 * - campaign_aggregations (refreshed daily)
 * - weekly_aggregations (refreshed weekly)
 * 
 * Usage:
 *   node scripts/refresh-analytics-views.js [--daily] [--weekly] [--all]
 * 
 * Default: --all (refreshes all views)
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');
const MaterializedViewRefresher = require('../services/materialized-view-refresher');

// Parse command line arguments
const args = process.argv.slice(2);
const refreshDaily = args.includes('--daily') || args.includes('--all') || args.length === 0;
const refreshWeekly = args.includes('--weekly') || args.includes('--all') || args.length === 0;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

/**
 * Main execution
 */
async function main() {
  const refresher = new MaterializedViewRefresher(pool);
  
  try {
    logger.info('📊 Starting analytics materialized views refresh...', {
      daily: refreshDaily,
      weekly: refreshWeekly
    });

    // Get initial stats
    logger.info('📊 Getting current view statistics...');
    const initialStats = await refresher.getViewStats();
    logger.info('📊 Current view statistics:', initialStats);

    // Refresh views
    const result = await refresher.refreshAll({
      daily: refreshDaily,
      weekly: refreshWeekly,
      concurrent: true
    });

    // Get updated stats
    logger.info('📊 Getting updated view statistics...');
    const updatedStats = await refresher.getViewStats();
    logger.info('📊 Updated view statistics:', updatedStats);

    // Summary
    logger.info('📊 ✅ Refresh completed successfully!', {
      views_refreshed: result.refreshed,
      errors: result.errors,
      refreshed_views: result.views_refreshed,
      errors_details: result.view_errors
    });

    if (result.errors > 0) {
      logger.warn('⚠️ Some views failed to refresh:', result.view_errors);
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error('💥 Refresh script failed:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };

