#!/usr/bin/env node

/**
 * Migration Runner for Event-Driven Architecture
 * Runs all database migrations in order
 * 
 * Usage:
 *   node scripts/run-migrations.js          # Run locally
 *   NODE_ENV=production node scripts/run-migrations.js   # Run on production
 */

const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const logger = require('../utils/logger');

// Database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Migration files in order
const MIGRATIONS = [
  '001_events_table.sql',
  '002_event_leaderboards.sql',
  '003_prizes.sql',
  '004_analytics_aggregates.sql',
  // ✅ NEW: Analytics Dashboard migrations (Phase 1-4)
  '020_create_user_acquisitions.sql',
  '021_add_campaign_id_to_events.sql',
  '022_create_campaign_costs.sql',
  '023_create_performance_metrics.sql',
  '024_create_crash_logs.sql',
  '025_partition_events_table_weekly.sql', // ⚠️ CRITICAL - backup first!
  '026_add_partition_indexes.sql',
  '027_create_daily_aggregations_mv.sql',
  '028_create_cohort_aggregations_mv.sql',
  '029_create_campaign_aggregations_mv.sql',
  '030_create_weekly_aggregations_mv.sql'
];

const MIGRATIONS_DIR = path.join(__dirname, '../database/migrations');

/**
 * Create migrations tracking table if not exists
 */
async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  logger.info('✅ Migrations tracking table ready');
}

/**
 * Check if migration has been run
 */
async function isMigrationExecuted(migrationName) {
  const result = await db.query(
    'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
    [migrationName]
  );
  return result.rows.length > 0;
}

/**
 * Mark migration as executed
 */
async function markMigrationExecuted(migrationName) {
  await db.query(
    'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
    [migrationName]
  );
}

/**
 * Run a single migration file
 */
async function runMigration(migrationName) {
  const migrationPath = path.join(MIGRATIONS_DIR, migrationName);
  
  try {
    logger.info(`📝 Running migration: ${migrationName}`);
    
    // Read migration file
    const sql = await fs.readFile(migrationPath, 'utf8');
    
    // Execute migration in a transaction
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await markMigrationExecuted(migrationName);
      await client.query('COMMIT');
      
      logger.info(`✅ Migration ${migrationName} completed successfully`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error(`❌ Migration ${migrationName} failed:`, error);
    throw error;
  }
}

/**
 * Run all pending migrations
 */
async function runAllMigrations() {
  try {
    logger.info('🚀 Starting database migrations...');
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Ensure migrations table exists
    await ensureMigrationsTable();
    
    let migrationsRun = 0;
    let migrationsSkipped = 0;
    
    // Run migrations in order
    for (const migration of MIGRATIONS) {
      const alreadyExecuted = await isMigrationExecuted(migration);
      
      if (alreadyExecuted) {
        logger.info(`⏭️  Skipping ${migration} (already executed)`);
        migrationsSkipped++;
        continue;
      }
      
      await runMigration(migration);
      migrationsRun++;
    }
    
    // Summary
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('🎉 Migrations completed successfully!');
    logger.info(`   Executed: ${migrationsRun}`);
    logger.info(`   Skipped:  ${migrationsSkipped}`);
    logger.info(`   Total:    ${MIGRATIONS.length}`);
    logger.info('='.repeat(60));
    logger.info('');
    
    // Verify key tables exist
    const tables = ['events', 'leaderboard_global', 'tournament_leaderboard', 'prizes', 'analytics_daily'];
    logger.info('🔍 Verifying tables...');
    
    for (const table of tables) {
      const result = await db.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_name = $1
      `, [table]);
      
      if (result.rows[0].count > 0) {
        logger.info(`   ✅ ${table}`);
      } else {
        logger.error(`   ❌ ${table} NOT FOUND!`);
        throw new Error(`Table ${table} not created`);
      }
    }
    
    logger.info('');
    logger.info('✨ All tables verified! Database is ready.');
    logger.info('');
    
  } catch (error) {
    logger.error('💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

/**
 * Show migration status
 */
async function showMigrationStatus() {
  try {
    logger.info('📊 Migration Status:');
    logger.info('');
    
    await ensureMigrationsTable();
    
    const executed = await db.query(
      'SELECT migration_name, executed_at FROM schema_migrations ORDER BY executed_at'
    );
    
    const executedNames = new Set(executed.rows.map(r => r.migration_name));
    
    for (const migration of MIGRATIONS) {
      if (executedNames.has(migration)) {
        const row = executed.rows.find(r => r.migration_name === migration);
        logger.info(`   ✅ ${migration} (executed ${row.executed_at.toISOString()})`);
      } else {
        logger.info(`   ⏳ ${migration} (pending)`);
      }
    }
    
    logger.info('');
  } catch (error) {
    logger.error('Error showing migration status:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Main
const command = process.argv[2];

if (command === 'status') {
  showMigrationStatus();
} else {
  runAllMigrations();
}

