/**
 * Admin routes for database maintenance
 * TEMPORARY - for emergency schema fixes
 */

const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

// Database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Emergency database schema fix endpoint
 * GET /api/admin/fix-schema
 */
router.get('/fix-schema', async (req, res) => {
  try {
    console.log('🔧 Starting emergency database schema fix...');
    
    // Test connection
    await db.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    const results = [];

    // 1. Create missing game_sessions table
    console.log('📋 Creating game_sessions table...');
    await db.query(`
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
    results.push('✅ game_sessions table created');

    // 2. Add missing columns to players table
    console.log('🔧 Adding missing columns to players table...');
    
    try {
      await db.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS player_id UUID;');
      results.push('✅ player_id column added');
    } catch (e) {
      results.push(`⚠️ player_id: ${e.message}`);
    }
    
    try {
      await db.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS player_name VARCHAR(255);');
      results.push('✅ player_name column added');
    } catch (e) {
      results.push(`⚠️ player_name: ${e.message}`);
    }
    
    try {
      await db.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS jet_skin VARCHAR(100) DEFAULT \'sky_jet\';');
      results.push('✅ jet_skin column added');
    } catch (e) {
      results.push(`⚠️ jet_skin: ${e.message}`);
    }
    
    try {
      await db.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS theme VARCHAR(100) DEFAULT \'sky\';');
      results.push('✅ theme column added');
    } catch (e) {
      results.push(`⚠️ theme: ${e.message}`);
    }
    
    try {
      await db.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS total_games INTEGER DEFAULT 0;');
      results.push('✅ total_games column added');
    } catch (e) {
      results.push(`⚠️ total_games: ${e.message}`);
    }

    // 3. Update player_id and player_name
    console.log('🔄 Updating player_id and player_name...');
    const updateResult1 = await db.query('UPDATE players SET player_id = id WHERE player_id IS NULL;');
    results.push(`✅ Updated ${updateResult1.rowCount} player_id records`);
    
    const updateResult2 = await db.query('UPDATE players SET player_name = nickname WHERE player_name IS NULL OR player_name = \'\';');
    results.push(`✅ Updated ${updateResult2.rowCount} player_name records`);

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
        await db.query(indexQuery);
        results.push(`✅ Index created: ${indexQuery.split(' ')[5]}`);
      } catch (e) {
        results.push(`⚠️ Index error: ${e.message}`);
      }
    }

    // 5. Fix analytics events table
    console.log('📊 Fixing analytics_events table...');
    try {
      // First update null values
      const analyticsUpdate = await db.query('UPDATE analytics_events SET event_name = \'unknown_event\' WHERE event_name IS NULL;');
      results.push(`✅ Fixed ${analyticsUpdate.rowCount} null event_name records`);
      
      // Add default value
      await db.query('ALTER TABLE analytics_events ALTER COLUMN event_name SET DEFAULT \'unknown_event\';');
      results.push('✅ Added default value to event_name column');
    } catch (e) {
      results.push(`⚠️ Analytics fix error: ${e.message}`);
    }

    // Test the fixes
    console.log('🧪 Testing fixes...');
    
    // Test game_sessions table
    const gameSessionsTest = await db.query('SELECT COUNT(*) FROM game_sessions;');
    results.push(`✅ game_sessions table: ${gameSessionsTest.rows[0].count} records`);
    
    // Test players table columns
    const playersTest = await db.query('SELECT player_id, player_name FROM players LIMIT 1;');
    results.push(`✅ players table: ${playersTest.rows.length > 0 ? 'columns accessible' : 'no data'}`);

    console.log('🎉 All fixes applied and tested successfully!');

    res.json({
      success: true,
      message: 'Database schema fix completed successfully!',
      results: results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fixing database schema:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;