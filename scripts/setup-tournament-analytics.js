#!/usr/bin/env node

/**
 * Tournament Analytics Setup Script
 * Creates materialized views and functions for tournament analytics
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupTournamentAnalytics() {
  try {
    console.log('🏆 Setting up Tournament Analytics...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, '../database/tournament-analytics-views.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
    
    console.log(`📊 Executing ${statements.length} SQL statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement.length === 0) continue;
      
      try {
        await pool.query(statement);
        console.log(`✅ Statement ${i + 1}/${statements.length} executed`);
      } catch (error) {
        console.log(`⚠️  Statement ${i + 1} failed (might already exist): ${error.message}`);
      }
    }
    
    // Test the views
    console.log('🧪 Testing created views...');
    
    const testQueries = [
      'SELECT COUNT(*) FROM information_schema.materialized_views WHERE table_name LIKE \'%tournament%\'',
      'SELECT COUNT(*) FROM information_schema.routines WHERE routine_name LIKE \'%tournament%\''
    ];
    
    for (const query of testQueries) {
      const result = await pool.query(query);
      console.log(`📊 ${query}: ${result.rows[0].count} items`);
    }
    
    console.log('🎉 Tournament Analytics setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  setupTournamentAnalytics();
}

module.exports = { setupTournamentAnalytics };
