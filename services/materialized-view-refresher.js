/**
 * Materialized View Refresher Service
 * 
 * Refreshes materialized views for dashboard performance
 * - Daily aggregations: Refreshed daily
 * - Cohort aggregations: Refreshed daily
 * - Campaign aggregations: Refreshed daily (after cost import)
 * - Weekly aggregations: Refreshed weekly (every Monday)
 * 
 * Railway Best Practice: Use REFRESH MATERIALIZED VIEW CONCURRENTLY
 * PostgreSQL Best Practice: Schedule during low-traffic hours
 */

const logger = require('../utils/logger');

class MaterializedViewRefresher {
  constructor(db) {
    this.db = db;
  }

  /**
   * Refresh all materialized views
   * 
   * @param {Object} options - Refresh options
   * @param {boolean} options.daily - Refresh daily views (default: true)
   * @param {boolean} options.weekly - Refresh weekly views (default: false)
   * @param {boolean} options.concurrent - Use CONCURRENT refresh (default: true)
   * @returns {Promise<Object>} - { refreshed, errors }
   */
  async refreshAll(options = {}) {
    const {
      daily = true,
      weekly = false,
      concurrent = true
    } = options;

    const refreshed = [];
    const errors = [];

    try {
      logger.info('📊 Starting materialized view refresh...', { daily, weekly, concurrent });

      // Refresh daily views
      if (daily) {
        const dailyViews = [
          'daily_aggregations',
          'cohort_aggregations',
          'campaign_aggregations'
        ];

        for (const viewName of dailyViews) {
          try {
            await this.refreshView(viewName, concurrent);
            refreshed.push(viewName);
            logger.info(`✅ Refreshed ${viewName}`);
          } catch (error) {
            errors.push({
              view: viewName,
              error: error.message
            });
            logger.error(`❌ Failed to refresh ${viewName}:`, error.message);
          }
        }
      }

      // Refresh weekly views
      if (weekly) {
        const weeklyViews = ['weekly_aggregations'];

        for (const viewName of weeklyViews) {
          try {
            await this.refreshView(viewName, concurrent);
            refreshed.push(viewName);
            logger.info(`✅ Refreshed ${viewName}`);
          } catch (error) {
            errors.push({
              view: viewName,
              error: error.message
            });
            logger.error(`❌ Failed to refresh ${viewName}:`, error.message);
          }
        }
      }

      logger.info('📊 Materialized view refresh completed', {
        refreshed: refreshed.length,
        errors: errors.length
      });

      return {
        refreshed: refreshed.length,
        errors: errors.length,
        views_refreshed: refreshed,
        view_errors: errors
      };
    } catch (error) {
      logger.error('❌ Materialized view refresh failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Refresh a specific materialized view
   * 
   * @param {string} viewName - Name of the materialized view
   * @param {boolean} concurrent - Use CONCURRENT refresh (default: true)
   * @param {number} timeoutMs - Query timeout in milliseconds (default: 5 minutes)
   * @returns {Promise<void>}
   */
  async refreshView(viewName, concurrent = true, timeoutMs = 300000) {
    const client = await this.db.connect();
    try {
      const refreshType = concurrent ? 'CONCURRENTLY' : '';
      const query = `REFRESH MATERIALIZED VIEW ${refreshType} ${viewName}`;

      logger.info(`🔄 Refreshing ${viewName}...`, { concurrent, timeoutMs });

      // Set a longer statement timeout for materialized view refresh
      await client.query(`SET statement_timeout = ${timeoutMs}`);

      const startTime = Date.now();
      await client.query(query);
      const duration = Date.now() - startTime;

      logger.info(`✅ ${viewName} refreshed`, {
        duration_ms: duration,
        concurrent
      });
    } catch (error) {
      logger.error(`❌ Failed to refresh ${viewName}`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  }

  /**
   * Refresh level performance and user funnel views
   * These are refreshed more frequently (every 6 hours) for better real-time analytics
   * 
   * @param {boolean} concurrent - Use CONCURRENT refresh (default: true)
   * @returns {Promise<Object>} - { refreshed, errors }
   */
  async refreshAnalyticsViews(concurrent = true) {
    const refreshed = [];
    const errors = [];

    try {
      logger.info('📊 Starting analytics views refresh (level performance & user funnel)...', { concurrent });

      const analyticsViews = [
        'level_performance_daily',
        'user_funnel_daily'
      ];

      for (const viewName of analyticsViews) {
        try {
          await this.refreshView(viewName, concurrent);
          refreshed.push(viewName);
          logger.info(`✅ Refreshed ${viewName}`);
        } catch (error) {
          errors.push({
            view: viewName,
            error: error.message
          });
          logger.error(`❌ Failed to refresh ${viewName}:`, error.message);
        }
      }

      logger.info('📊 Analytics views refresh completed', {
        refreshed: refreshed.length,
        errors: errors.length
      });

      return {
        refreshed: refreshed.length,
        errors: errors.length,
        views_refreshed: refreshed,
        view_errors: errors
      };
    } catch (error) {
      logger.error('❌ Analytics views refresh failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get materialized view statistics
   * 
   * @returns {Promise<Array>} - Array of view statistics
   */
  async getViewStats() {
    try {
      const query = `
        SELECT 
          schemaname,
          matviewname as view_name,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||matviewname)) as size,
          pg_stat_get_live_tuples(c.oid) as row_count,
          pg_stat_get_last_analyze_time(c.oid) as last_analyzed
        FROM pg_matviews m
        JOIN pg_class c ON c.relname = m.matviewname
        WHERE schemaname = 'public'
          AND matviewname IN ('daily_aggregations', 'cohort_aggregations', 
                              'campaign_aggregations', 'weekly_aggregations',
                              'level_performance_daily', 'user_funnel_daily')
        ORDER BY matviewname
      `;

      const result = await this.db.query(query);

      return result.rows.map(row => ({
        view_name: row.view_name,
        size: row.size,
        row_count: parseInt(row.row_count || 0),
        last_analyzed: row.last_analyzed
      }));
    } catch (error) {
      logger.error('❌ Failed to get view stats', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = MaterializedViewRefresher;

