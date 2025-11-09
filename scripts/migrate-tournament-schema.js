#!/usr/bin/env node

// ⛔⛔⛔ DEPRECATED - DO NOT USE ⛔⛔⛔
// This script applies the OLD JWT-based tournament schema
// It has been REPLACED by the new event-driven migration system
//
// Use this instead:
//   node scripts/run-migrations.js
//
// This will run migrations 001-005 which include the NEW
// event-driven tournament system with proper schema.
//
// See: CLEANUP_SUMMARY.md for details
// ⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔

console.error('⛔ ERROR: This script is deprecated!');
console.error('⛔ Use: node scripts/run-migrations.js');
console.error('⛔ See: CLEANUP_SUMMARY.md for details');
process.exit(1);

/**
 * Tournament Schema Migration Script
 * Runs the tournament-schema.sql file against the Railway database
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration(existingDb = null) {
  console.log('🚂 Starting Tournament Schema Migration...');
  
  // Use existing database connection or create new one
  const db = existingDb || new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  try {
    // Test connection
    console.log('🐘 Testing database connection...');
    await db.query('SELECT NOW()');
    console.log('🐘 ✅ Database connected successfully');

    // Read the schema file
    const schemaPath = path.join(__dirname, '../database/tournament-schema.sql');
    console.log('📄 Reading schema file:', schemaPath);
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }
    
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    console.log('📄 ✅ Schema file loaded');

    // Execute the schema
    console.log('🏗️ Creating tournament tables and functions...');
    await db.query(schemaSql);
    console.log('🏗️ ✅ Tournament schema created successfully');

    // Verify tables were created
    console.log('🔍 Verifying table creation...');
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('tournaments', 'tournament_participants', 'tournament_scores', 'tournament_events')
      ORDER BY table_name
    `);
    
    console.log('🔍 ✅ Tables created:', tables.rows.map(r => r.table_name));

    // Check if we should create a sample tournament
    const existingTournaments = await db.query('SELECT COUNT(*) as count FROM tournaments');
    if (existingTournaments.rows[0].count === '0') {
      console.log('🏆 Creating initial weekly tournament...');
      
      const startDate = new Date();
      startDate.setUTCHours(0, 0, 0, 0); // Start of today
      
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7); // One week from start
      
      await db.query(`
        INSERT INTO tournaments (
          name, 
          description, 
          tournament_type, 
          start_date, 
          end_date, 
          status,
          prize_pool,
          prize_distribution
        ) VALUES (
          'Weekly Championship #1',
          'First weekly tournament with coin prizes! Compete for the top spots and earn coins.',
          'weekly',
          $1,
          $2,
          'active',
          1750,
          '{"1": 1000, "2": 500, "3": 250}'
        )
      `, [startDate, endDate]);
      
      console.log('🏆 ✅ Initial tournament created');
    }

    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Only close connection if we created it (not using existing one)
    if (!existingDb) {
      await db.end();
      console.log('🐘 Database connection closed');
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };
