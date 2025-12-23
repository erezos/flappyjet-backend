/**
 * Google Ads Service
 * 
 * Fetches campaign cost data from Google Ads API
 * Used for ROI analysis (CPI, revenue vs cost)
 * 
 * Railway Best Practice: Use environment variables for API credentials
 */

const logger = require('../utils/logger');

class GoogleAdsService {
  constructor() {
    // Google Ads API credentials (from environment variables)
    this.clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    this.refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
    this.developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    this.customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    
    this.isConfigured = !!(
      this.clientId &&
      this.clientSecret &&
      this.refreshToken &&
      this.developerToken &&
      this.customerId
    );
    
    if (!this.isConfigured) {
      logger.warn('⚠️ Google Ads API not configured - set environment variables');
    }
  }

  /**
   * Authenticate with Google Ads API
   * Returns access token for API requests
   * 
   * @returns {Promise<string>} - Access token
   */
  async authenticate() {
    if (!this.isConfigured) {
      throw new Error('Google Ads API not configured');
    }

    try {
      // Use OAuth2 to get access token
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Google Ads authentication failed: ${error}`);
      }

      const data = await response.json();
      return data.access_token;
    } catch (error) {
      logger.error('❌ Google Ads authentication failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Fetch campaign cost data for a specific date
   * 
   * @param {Date|string} date - Date to fetch costs for (YYYY-MM-DD format)
   * @returns {Promise<Array>} - Array of campaign cost records
   */
  async fetchCampaignCosts(date) {
    if (!this.isConfigured) {
      logger.warn('⚠️ Google Ads API not configured - skipping cost fetch');
      return [];
    }

    try {
      const accessToken = await this.authenticate();
      const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;
      
      // Google Ads API query to get campaign performance
      // Using Google Ads Query Language (GAQL)
      const query = `
        SELECT
          campaign.id,
          campaign.name,
          segments.date,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions
        FROM campaign
        WHERE segments.date = '${dateStr}'
          AND campaign.status = 'ENABLED'
        ORDER BY campaign.id
      `;

      const response = await fetch(
        `https://googleads.googleapis.com/v14/customers/${this.customerId}/googleAds:search`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': this.developerToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: query,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Google Ads API request failed: ${error}`);
      }

      const data = await response.json();
      
      // Transform Google Ads API response to our format
      const costs = data.results?.map((row) => ({
        campaign_id: row.campaign.id.toString(),
        campaign_name: row.campaign.name,
        date: dateStr,
        cost_usd: parseFloat(row.metrics.cost_micros) / 1000000, // Convert micros to USD
        impressions: parseInt(row.metrics.impressions) || 0,
        clicks: parseInt(row.metrics.clicks) || 0,
        installs: parseInt(row.metrics.conversions) || 0, // Assuming conversions = installs
      })) || [];

      logger.info('✅ Fetched campaign costs from Google Ads API', {
        date: dateStr,
        campaign_count: costs.length,
        total_cost: costs.reduce((sum, c) => sum + c.cost_usd, 0)
      });

      return costs;
    } catch (error) {
      logger.error('❌ Failed to fetch campaign costs from Google Ads API', {
        date: date,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Fetch campaign costs for a date range
   * 
   * @param {Date|string} startDate - Start date (YYYY-MM-DD)
   * @param {Date|string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Array>} - Array of campaign cost records
   */
  async fetchCampaignCostsRange(startDate, endDate) {
    if (!this.isConfigured) {
      return [];
    }

    const costs = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Fetch costs for each day in range
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      try {
        const dayCosts = await this.fetchCampaignCosts(date);
        costs.push(...dayCosts);
        
        // Rate limiting: Wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error('❌ Failed to fetch costs for date', {
          date: date.toISOString().split('T')[0],
          error: error.message
        });
        // Continue with next date even if one fails
      }
    }

    return costs;
  }

  /**
   * Check if Google Ads API is configured
   * 
   * @returns {boolean}
   */
  isAvailable() {
    return this.isConfigured;
  }
}

module.exports = GoogleAdsService;

