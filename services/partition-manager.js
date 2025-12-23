/**
 * Partition Manager Service
 * 
 * Maintains weekly partitions for events table
 * - Creates future partitions (12 weeks ahead)
 * - Drops old partitions (>12 months)
 * 
 * Railway Best Practice: Run weekly via cron (every Monday)
 */

const logger = require('../utils/logger');

class PartitionManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * Maintain weekly partitions
   * Creates future partitions and drops old ones
   * 
   * @returns {Promise<Object>} - { created, dropped, errors }
   */
  async maintainPartitions() {
    try {
      logger.info('📊 Starting partition maintenance...');

      // Call PostgreSQL function to maintain partitions
      const result = await this.db.query('SELECT maintain_weekly_partitions()');

      logger.info('✅ Partition maintenance completed');

      return {
        success: true,
        message: 'Partitions maintained successfully'
      };
    } catch (error) {
      logger.error('❌ Partition maintenance failed', {
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get partition information
   * 
   * @returns {Promise<Array>} - Array of partition info
   */
  async getPartitionInfo() {
    try {
      const query = `
        SELECT 
          schemaname,
          tablename as partition_name,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_stat_get_live_tuples(c.oid) as row_count
        FROM pg_tables t
        JOIN pg_class c ON c.relname = t.tablename
        WHERE schemaname = 'public'
          AND tablename LIKE 'events_week_%'
        ORDER BY tablename DESC
      `;

      const result = await this.db.query(query);

      return result.rows.map(row => ({
        partition_name: row.partition_name,
        size: row.size,
        row_count: parseInt(row.row_count || 0)
      }));
    } catch (error) {
      logger.error('❌ Failed to get partition info', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a specific weekly partition
   * 
   * @param {Date|string} weekStart - Start date of the week (Monday)
   * @returns {Promise<Object>} - { success, partition_name }
   */
  async createPartition(weekStart) {
    try {
      const date = weekStart instanceof Date ? weekStart : new Date(weekStart);
      const dateStr = date.toISOString().split('T')[0];

      await this.db.query('SELECT create_weekly_partition($1::date)', [dateStr]);

      logger.info('✅ Created partition for week', { week_start: dateStr });

      return {
        success: true,
        partition_name: `events_week_${dateStr.replace(/-/g, '_')}`
      };
    } catch (error) {
      logger.error('❌ Failed to create partition', {
        week_start: weekStart,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Drop old partitions (>12 months)
   * 
   * @param {number} monthsToKeep - Number of months to keep (default: 12)
   * @returns {Promise<Object>} - { dropped, errors }
   */
  async dropOldPartitions(monthsToKeep = 12) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
      const cutoffWeekStart = this._getWeekStart(cutoffDate);
      const cutoffStr = cutoffWeekStart.toISOString().split('T')[0].replace(/-/g, '_');

      const query = `
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
          AND tablename LIKE 'events_week_%'
          AND tablename < 'events_week_${cutoffStr}'
      `;

      const result = await this.db.query(query);
      const partitionsToDrop = result.rows.map(r => r.tablename);

      const dropped = [];
      const errors = [];

      for (const partitionName of partitionsToDrop) {
        try {
          await this.db.query(`DROP TABLE IF EXISTS ${partitionName} CASCADE`);
          dropped.push(partitionName);
          logger.info('🗑️ Dropped old partition', { partition_name: partitionName });
        } catch (error) {
          errors.push({
            partition_name: partitionName,
            error: error.message
          });
          logger.error('❌ Failed to drop partition', {
            partition_name: partitionName,
            error: error.message
          });
        }
      }

      return {
        dropped: dropped.length,
        errors: errors.length,
        partitions_dropped: dropped,
        partition_errors: errors
      };
    } catch (error) {
      logger.error('❌ Failed to drop old partitions', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get start of week (Monday) for a given date
   * 
   * @param {Date} date - Date
   * @returns {Date} - Monday of that week
   */
  _getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    return new Date(d.setDate(diff));
  }
}

module.exports = PartitionManager;

