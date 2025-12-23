#!/usr/bin/env node

/**
 * Test Google Ads API Import
 * 
 * Tests the Google Ads API connection and imports campaign costs
 * Run: node scripts/test-google-ads-import.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');
const CampaignCostImporter = require('../services/campaign-cost-importer');

async function test() {
  console.log('🧪 Testing Google Ads API Import...\n');

  // Check environment variables
  const requiredVars = [
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CUSTOMER_ID',
    'DATABASE_URL'
  ];

  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
    console.error('\n💡 See GOOGLE_ADS_API_SETUP.md for setup instructions');
    process.exit(1);
  }

  console.log('✅ All environment variables found\n');

  // Initialize database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Initialize importer
    const importer = new CampaignCostImporter(pool);

    // Check if Google Ads API is configured
    if (!importer.googleAds.isAvailable()) {
      console.error('❌ Google Ads API not configured');
      console.error('💡 Check your environment variables');
      process.exit(1);
    }

    console.log('✅ Google Ads API is configured\n');

    // Test import for yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateStr = yesterday.toISOString().split('T')[0];
    
    console.log(`📊 Importing campaign costs for: ${dateStr}\n`);
    
    const result = await importer.importCosts(yesterday);

    console.log('\n📊 Import Results:');
    console.log(`   ✅ Imported: ${result.imported} campaigns`);
    console.log(`   ⏭️  Skipped: ${result.skipped} campaigns`);
    console.log(`   ❌ Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      result.errors.slice(0, 5).forEach((err, i) => {
        console.log(`   ${i + 1}. Campaign ${err.campaign_id}: ${err.error}`);
      });
      if (result.errors.length > 5) {
        console.log(`   ... and ${result.errors.length - 5} more errors`);
      }
    }

    // Verify data in database
    if (result.imported > 0) {
      const verifyResult = await pool.query(`
        SELECT 
          campaign_id,
          campaign_name,
          date,
          cost_usd,
          impressions,
          clicks,
          installs
        FROM campaign_costs
        WHERE date = $1
        ORDER BY cost_usd DESC
        LIMIT 5
      `, [dateStr]);

      if (verifyResult.rows.length > 0) {
        console.log('\n✅ Verified imported data:');
        verifyResult.rows.forEach((row, i) => {
          console.log(`   ${i + 1}. ${row.campaign_name} (${row.campaign_id}): $${row.cost_usd.toFixed(2)}`);
        });
      }
    }

    console.log('\n✅ Test completed successfully!');
    console.log('💡 The daily cron job will run automatically at 5 AM');

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run test
if (require.main === module) {
  test().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { test };

