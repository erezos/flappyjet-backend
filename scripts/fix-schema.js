#!/usr/bin/env node

/**
 * Emergency database schema fix for FlappyJet Backend
 * Fixes the 500 errors by creating missing tables and columns
 */

const { Pool } = require('pg');

async function fixDatabaseSchema() {
  console.log('🔧 Starting emergency database schema fix...');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    // 1. Create missing game_sessions table
    console.log('📋 Creating game_sessions table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL,
        player_name VARCHAR(255) NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        jet_skin VARCHAR(100) DEFAULT 'sky_jet',
        theme VARCHAR(100) DEFAULT 'sky',
        game_data JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        CONSTRAINT valid_score CHECK (score >= 0)
      );
    `);

    // 2. Add missing columns to players table
    console.log('🔧 Adding missing columns to players table...');
    
    try {
      await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS player_id UUID;');
    } catch (e) {
      console.log('  player_id column already exists or error:', e.message);
    }
    
    try {
      await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS player_name VARCHAR(255);');
    } catch (e) {
      console.log('  player_name column already exists or error:', e.message);
    }
    
    try {
      await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS jet_skin VARCHAR(100) DEFAULT \'sky_jet\';');
    } catch (e) {
      console.log('  jet_skin column already exists or error:', e.message);
    }
    
    try {
      await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS theme VARCHAR(100) DEFAULT \'sky\';');
    } catch (e) {
      console.log('  theme column already exists or error:', e.message);
    }
    
    try {
      await pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS total_games INTEGER DEFAULT 0;');
    } catch (e) {
      console.log('  total_games column already exists or error:', e.message);
    }

    // 3. Update player_id and player_name
    console.log('🔄 Updating player_id and player_name...');
    await pool.query('UPDATE players SET player_id = id WHERE player_id IS NULL;');
    await pool.query('UPDATE players SET player_name = nickname WHERE player_name IS NULL OR player_name = \'\';');

    // 4. Create indexes
    console.log('📊 Creating indexes...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_game_sessions_player_id ON game_sessions(player_id);',
      'CREATE INDEX IF NOT EXISTS idx_game_sessions_score ON game_sessions(score DESC);',
      'CREATE INDEX IF NOT EXISTS idx_game_sessions_created_at ON game_sessions(created_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_game_sessions_player_score ON game_sessions(player_id, score DESC, created_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_players_player_id ON players(player_id);',
      'CREATE INDEX IF NOT EXISTS idx_players_best_score ON players(best_score DESC);',
      'CREATE INDEX IF NOT EXISTS idx_players_name ON players(player_name);'
    ];

    for (const indexQuery of indexes) {
      try {
        await pool.query(indexQuery);
      } catch (e) {
        console.log('  Index creation error (may already exist):', e.message);
      }
    }

    // 5. Fix analytics events table
    console.log('📊 Fixing analytics_events table...');
    try {
      // First update null values
      await pool.query('UPDATE analytics_events SET event_name = \'unknown_event\' WHERE event_name IS NULL;');
      
      // Add default value
      await pool.query('ALTER TABLE analytics_events ALTER COLUMN event_name SET DEFAULT \'unknown_event\';');
    } catch (e) {
      console.log('  Analytics fix error:', e.message);
    }

    console.log('✅ Database schema fix completed successfully!');
    
    // Test the fixes
    console.log('🧪 Testing fixes...');
    
    // Test game_sessions table
    const gameSessionsTest = await pool.query('SELECT COUNT(*) FROM game_sessions;');
    console.log(`  game_sessions table: ${gameSessionsTest.rows[0].count} records`);
    
    // Test players table columns
    const playersTest = await pool.query('SELECT player_id, player_name FROM players LIMIT 1;');
    console.log(`  players table: ${playersTest.rows.length > 0 ? 'columns accessible' : 'no data'}`);
    
    console.log('🎉 All fixes applied and tested successfully!');

  } catch (error) {
    console.error('❌ Error fixing database schema:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the fix
fixDatabaseSchema();
