#!/usr/bin/env node

/**
 * Import Campaign Costs from CSV
 * 
 * Alternative to Google Ads API - allows manual CSV import
 * 
 * CSV Format (with header row):
 * campaign_id,campaign_name,date,cost_usd,impressions,clicks,installs
 * 1234567890,Summer Sale 2025,2025-12-22,150.50,50000,2500,125
 * 
 * Usage:
 *   node scripts/import-campaign-costs-csv.js < path/to/costs.csv
 *   OR
 *   node scripts/import-campaign-costs-csv.js costs.csv
 */

require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const logger = require('../utils/logger');
const readline = require('readline');

async function importFromCSV(filePath = null) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    let csvContent;
    
    if (filePath) {
      // Read from file
      csvContent = fs.readFileSync(filePath, 'utf-8');
    } else {
      // Read from stdin
      csvContent = await readStdin();
    }

    // Parse CSV
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      console.error('❌ CSV must have at least a header row and one data row');
      process.exit(1);
    }

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const requiredHeaders = ['campaign_id', 'date', 'cost_usd'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      console.error(`❌ Missing required headers: ${missingHeaders.join(', ')}`);
      console.error(`   Found headers: ${headers.join(', ')}`);
      process.exit(1);
    }

    // Parse data rows
    const costs = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || null;
      });

      // Validate required fields
      if (!row.campaign_id || !row.date || !row.cost_usd) {
        console.warn(`⚠️  Skipping row ${i + 1}: missing required fields`);
        continue;
      }

      costs.push({
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name || row.campaign || null,
        date: row.date,
        cost_usd: parseFloat(row.cost_usd) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        installs: parseInt(row.installs) || parseInt(row.conversions) || 0
      });
    }

    console.log(`📊 Found ${costs.length} campaign cost records to import\n`);

    // Import to database
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const cost of costs) {
      try {
        const result = await pool.query(`
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
          cost.installs
        ]);

        if (result.rows.length > 0) {
          imported++;
          console.log(`✅ Imported: ${cost.campaign_name || cost.campaign_id} (${cost.date}) - $${cost.cost_usd.toFixed(2)}`);
        } else {
          skipped++;
        }
      } catch (error) {
        errors.push({
          campaign_id: cost.campaign_id,
          date: cost.date,
          error: error.message
        });
        console.error(`❌ Failed: ${cost.campaign_id} (${cost.date}) - ${error.message}`);
      }
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`   ✅ Imported: ${imported}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\n⚠️  Errors:`);
      errors.slice(0, 5).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.campaign_id} (${err.date}): ${err.error}`);
      });
    }

    return { imported, skipped, errors };

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let content = '';
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('line', (line) => {
      content += line + '\n';
    });

    rl.on('close', () => {
      resolve(content);
    });
  });
}

// Run if called directly
if (require.main === module) {
  const filePath = process.argv[2];
  
  importFromCSV(filePath)
    .then(() => {
      console.log('\n✅ Import completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Import failed:', error);
      process.exit(1);
    });
}

module.exports = { importFromCSV };

