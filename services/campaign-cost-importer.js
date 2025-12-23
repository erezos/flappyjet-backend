/**
 * Campaign Cost Importer
 * 
 * Scheduled job to import daily campaign costs from Google Ads API
 * Runs daily to import previous day's cost data
 * 
 * Railway Best Practice: Use Railway cron jobs or node-cron
 */

const logger = require('../utils/logger');
const GoogleAdsService = require('./google-ads-service');

class CampaignCostImporter {
  constructor(db) {
    this.db = db;
    this.googleAds = new GoogleAdsService();
  }

  /**
   * Import campaign costs for a specific date
   * 
   * @param {Date|string} date - Date to import costs for (default: yesterday)
   * @returns {Promise<Object>} - { imported, skipped, errors }
   */
  async importCosts(date = null) {
    if (!this.googleAds.isAvailable()) {
      logger.warn('⚠️ Google Ads API not configured - skipping cost import');
      return { imported: 0, skipped: 0, errors: [] };
    }

    // Default to yesterday (previous day's data)
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateStr = targetDate instanceof Date 
      ? targetDate.toISOString().split('T')[0] 
      : targetDate;

    logger.info('📊 Starting campaign cost import', { date: dateStr });

    try {
      // Fetch costs from Google Ads API
      const costs = await this.googleAds.fetchCampaignCosts(targetDate);

      if (costs.length === 0) {
        logger.info('📊 No campaign costs found for date', { date: dateStr });
        return { imported: 0, skipped: 0, errors: [] };
      }

      // Import costs into database
      let imported = 0;
      let skipped = 0;
      const errors = [];

      for (const cost of costs) {
        try {
          const result = await this.db.query(`
            INSERT INTO campaign_costs (
              campaign_id,
              campaign_name,
              date,
              cost_usd,
              impressions,
              clicks,
              installs,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            ON CONFLICT (campaign_id, date) DO UPDATE SET
              campaign_name = EXCLUDED.campaign_name,
              cost_usd = EXCLUDED.cost_usd,
              impressions = EXCLUDED.impressions,
              clicks = EXCLUDED.clicks,
              installs = EXCLUDED.installs,
              updated_at = NOW()
            RETURNING id
          `, [
            cost.campaign_id,
            cost.campaign_name,
            cost.date,
            cost.cost_usd,
            cost.impressions,
            cost.clicks,
            cost.installs,
          ]);

          if (result.rows.length > 0) {
            imported++;
          } else {
            skipped++;
          }
        } catch (error) {
          errors.push({
            campaign_id: cost.campaign_id,
            error: error.message
          });
          logger.error('❌ Failed to import campaign cost', {
            campaign_id: cost.campaign_id,
            date: cost.date,
            error: error.message
          });
        }
      }

      logger.info('✅ Campaign cost import completed', {
        date: dateStr,
        imported,
        skipped,
        errors: errors.length,
        total_campaigns: costs.length
      });

      return { imported, skipped, errors };
    } catch (error) {
      logger.error('❌ Campaign cost import failed', {
        date: dateStr,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Import costs for a date range
   * 
   * @param {Date|string} startDate - Start date
   * @param {Date|string} endDate - End date
   * @returns {Promise<Object>} - Summary of import
   */
  async importCostsRange(startDate, endDate) {
    const summary = {
      imported: 0,
      skipped: 0,
      errors: []
    };

    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      try {
        const result = await this.importCosts(date);
        summary.imported += result.imported;
        summary.skipped += result.skipped;
        summary.errors.push(...result.errors);
      } catch (error) {
        summary.errors.push({
          date: date.toISOString().split('T')[0],
          error: error.message
        });
      }
    }

    return summary;
  }
}

module.exports = CampaignCostImporter;

