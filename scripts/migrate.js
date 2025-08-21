#!/usr/bin/env node
/// 🗄️ Database Migration Script for FlappyJet Backend
const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

console.log(`🗄️ Running database migrations for ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} environment...`);

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Migration scripts in order
const migrations = [
  {
    name: '001_create_players_table',
    sql: `
      CREATE TABLE IF NOT EXISTS players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id VARCHAR(255) UNIQUE NOT NULL,
        nickname VARCHAR(100) NOT NULL DEFAULT 'Anonymous Player',
        platform VARCHAR(20) NOT NULL DEFAULT 'unknown',
        app_version VARCHAR(20) DEFAULT '1.0.0',
        best_score INTEGER DEFAULT 0,
        best_streak INTEGER DEFAULT 0,
        total_games_played INTEGER DEFAULT 0,
        total_coins_earned INTEGER DEFAULT 0,
        total_gems_earned INTEGER DEFAULT 0,
        current_coins INTEGER DEFAULT 500,
        current_gems INTEGER DEFAULT 25,
        current_hearts INTEGER DEFAULT 3,
        is_premium BOOLEAN DEFAULT false,
        heart_booster_expiry TIMESTAMP,
        country_code VARCHAR(2),
        timezone VARCHAR(50),
        is_banned BOOLEAN DEFAULT false,
        ban_reason TEXT,
        nickname_changes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_active_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_players_device_id ON players(device_id);
      CREATE INDEX IF NOT EXISTS idx_players_best_score ON players(best_score DESC);
      CREATE INDEX IF NOT EXISTS idx_players_created_at ON players(created_at);
    `
  },
  {
    name: '002_create_scores_table',
    sql: `
      CREATE TABLE IF NOT EXISTS scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        survival_time INTEGER NOT NULL DEFAULT 0,
        skin_used VARCHAR(50) DEFAULT 'sky_jet',
        coins_earned INTEGER DEFAULT 0,
        gems_earned INTEGER DEFAULT 0,
        game_duration INTEGER NOT NULL,
        actions_per_second DECIMAL(4,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_scores_player_id ON scores(player_id);
      CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
      CREATE INDEX IF NOT EXISTS idx_scores_created_at ON scores(created_at DESC);
    `
  },
  {
    name: '003_create_achievements_table',
    sql: `
      CREATE TABLE IF NOT EXISTS achievements (
        id VARCHAR(100) PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        rarity VARCHAR(20) NOT NULL DEFAULT 'common',
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        icon_url VARCHAR(500),
        target INTEGER NOT NULL DEFAULT 1,
        reward_coins INTEGER DEFAULT 0,
        reward_gems INTEGER DEFAULT 0,
        is_secret BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_achievements_category ON achievements(category);
      CREATE INDEX IF NOT EXISTS idx_achievements_rarity ON achievements(rarity);
    `
  },
  {
    name: '004_create_player_achievements_table',
    sql: `
      CREATE TABLE IF NOT EXISTS player_achievements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        achievement_id VARCHAR(100) NOT NULL REFERENCES achievements(id),
        progress INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(player_id, achievement_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_player_achievements_player_id ON player_achievements(player_id);
      CREATE INDEX IF NOT EXISTS idx_player_achievements_completed ON player_achievements(completed, completed_at);
    `
  },
  {
    name: '005_create_missions_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS missions_templates (
        id SERIAL PRIMARY KEY,
        mission_type VARCHAR(50) NOT NULL,
        difficulty_level VARCHAR(20) NOT NULL,
        title_template VARCHAR(200) NOT NULL,
        description_template TEXT NOT NULL,
        base_target INTEGER NOT NULL,
        base_reward INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS player_missions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        mission_type VARCHAR(50) NOT NULL,
        difficulty_level VARCHAR(20) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        target INTEGER NOT NULL,
        reward INTEGER NOT NULL,
        progress INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_player_missions_player_id ON player_missions(player_id);
      CREATE INDEX IF NOT EXISTS idx_player_missions_expires_at ON player_missions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_player_missions_completed ON player_missions(completed, completed_at);
    `
  },
  {
    name: '006_create_inventory_table',
    sql: `
      CREATE TABLE IF NOT EXISTS player_inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        item_type VARCHAR(50) NOT NULL,
        item_id VARCHAR(100) NOT NULL,
        quantity INTEGER DEFAULT 1,
        equipped BOOLEAN DEFAULT false,
        acquired_at TIMESTAMP DEFAULT NOW(),
        acquired_method VARCHAR(50) DEFAULT 'unknown',
        UNIQUE(player_id, item_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_player_inventory_player_id ON player_inventory(player_id);
      CREATE INDEX IF NOT EXISTS idx_player_inventory_equipped ON player_inventory(equipped);
    `
  },
  {
    name: '007_create_purchases_table',
    sql: `
      CREATE TABLE IF NOT EXISTS purchases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        product_id VARCHAR(100) NOT NULL,
        platform VARCHAR(20) NOT NULL,
        transaction_id VARCHAR(255) NOT NULL,
        receipt_data TEXT,
        amount_usd DECIMAL(6,2),
        currency_code VARCHAR(3) DEFAULT 'USD',
        status VARCHAR(20) DEFAULT 'pending',
        items_granted JSONB,
        processed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(platform, transaction_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_purchases_player_id ON purchases(player_id);
      CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
      CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at DESC);
    `
  },
  {
    name: '008_create_analytics_table',
    sql: `
      CREATE TABLE IF NOT EXISTS analytics_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID REFERENCES players(id) ON DELETE CASCADE,
        event_name VARCHAR(100) NOT NULL,
        event_category VARCHAR(50) NOT NULL,
        parameters JSONB DEFAULT '{}',
        session_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_analytics_events_player_id ON analytics_events(player_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
    `
  },
  {
    name: '009_create_leaderboard_views',
    sql: `
      -- Global leaderboard materialized view
      CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_global AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY p.best_score DESC, p.created_at ASC) as rank,
        p.id as player_id,
        p.nickname,
        p.best_score as score,
        p.country_code,
        (SELECT skin_used FROM scores s WHERE s.player_id = p.id AND s.score = p.best_score LIMIT 1) as skin_used,
        (SELECT created_at FROM scores s WHERE s.player_id = p.id AND s.score = p.best_score LIMIT 1) as achieved_at
      FROM players p
      WHERE p.best_score > 0 AND p.is_banned = false
      ORDER BY p.best_score DESC, p.created_at ASC;
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_global_rank ON leaderboard_global(rank);
      CREATE INDEX IF NOT EXISTS idx_leaderboard_global_player_id ON leaderboard_global(player_id);
      
      -- Weekly leaderboard materialized view
      CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_weekly AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY MAX(s.score) DESC, MIN(s.created_at) ASC) as rank,
        p.id as player_id,
        p.nickname,
        MAX(s.score) as score,
        p.country_code,
        (SELECT skin_used FROM scores s2 WHERE s2.player_id = p.id AND s2.score = MAX(s.score) AND s2.created_at >= CURRENT_DATE - INTERVAL '7 days' LIMIT 1) as skin_used,
        MAX(s.created_at) as achieved_at
      FROM players p
      JOIN scores s ON p.id = s.player_id
      WHERE s.created_at >= CURRENT_DATE - INTERVAL '7 days'
        AND p.is_banned = false
      GROUP BY p.id, p.nickname, p.country_code
      ORDER BY MAX(s.score) DESC, MIN(s.created_at) ASC;
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_weekly_rank ON leaderboard_weekly(rank);
      CREATE INDEX IF NOT EXISTS idx_leaderboard_weekly_player_id ON leaderboard_weekly(player_id);
    `
  }
];

// Seed data for achievements and mission templates
const seedData = [
  {
    name: 'seed_achievements',
    sql: `
      INSERT INTO achievements (id, category, rarity, title, description, target, reward_coins, reward_gems) VALUES
      ('first_flight', 'score', 'common', 'First Flight', 'Complete your first game', 1, 50, 5),
      ('sky_rookie', 'score', 'common', 'Sky Rookie', 'Reach 10 points in a single game', 10, 100, 10),
      ('cloud_surfer', 'score', 'rare', 'Cloud Surfer', 'Reach 25 points in a single game', 25, 200, 15),
      ('ace_pilot', 'score', 'epic', 'Ace Pilot', 'Reach 50 points in a single game', 50, 500, 25),
      ('sky_master', 'score', 'legendary', 'Sky Master', 'Reach 100 points in a single game', 100, 1000, 50),
      ('survivor', 'survival', 'common', 'Survivor', 'Survive for 30 seconds', 30, 150, 10),
      ('endurance_pilot', 'survival', 'rare', 'Endurance Pilot', 'Survive for 60 seconds', 60, 300, 20),
      ('marathon_flyer', 'survival', 'epic', 'Marathon Flyer', 'Survive for 120 seconds', 120, 600, 40),
      ('dedicated_player', 'games', 'common', 'Dedicated Player', 'Play 10 games', 10, 200, 15),
      ('game_enthusiast', 'games', 'rare', 'Game Enthusiast', 'Play 50 games', 50, 500, 30),
      ('jet_collector', 'skins', 'rare', 'Jet Collector', 'Unlock 3 different jet skins', 3, 300, 25)
      ON CONFLICT (id) DO NOTHING;
    `
  },
  {
    name: 'seed_mission_templates',
    sql: `
      INSERT INTO missions_templates (mission_type, difficulty_level, title_template, description_template, base_target, base_reward) VALUES
      ('play_games', 'easy', 'Take Flight', 'Play {target} games today', 3, 75),
      ('play_games', 'medium', 'Sky Explorer', 'Play {target} games today', 5, 125),
      ('play_games', 'hard', 'Aviation Master', 'Play {target} games today', 8, 200),
      ('reach_score', 'easy', 'Sky Achievement', 'Reach {target} points in a single game', 15, 100),
      ('reach_score', 'medium', 'Cloud Breaker', 'Reach {target} points in a single game', 30, 175),
      ('reach_score', 'hard', 'Altitude Champion', 'Reach {target} points in a single game', 60, 300),
      ('collect_coins', 'easy', 'Coin Hunter', 'Collect {target} coins today', 50, 100),
      ('collect_coins', 'medium', 'Treasure Seeker', 'Collect {target} coins today', 100, 150),
      ('survive_time', 'easy', 'Quick Survivor', 'Survive for {target} seconds in a single game', 45, 125),
      ('survive_time', 'medium', 'Endurance Test', 'Survive for {target} seconds in a single game', 90, 200),
      ('maintain_streak', 'medium', 'Consistency King', 'Maintain a streak of {target} games above 10 points', 3, 250),
      ('use_continue', 'easy', 'Second Chance', 'Use continue {target} times today', 2, 150),
      ('change_nickname', 'easy', 'Personal Touch', 'Change your nickname to personalize your profile', 1, 200)
      ON CONFLICT DO NOTHING;
    `
  }
];

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting database migrations...');
    
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Run migrations
    for (const migration of migrations) {
      const existing = await client.query(
        'SELECT name FROM migrations WHERE name = $1',
        [migration.name]
      );
      
      if (existing.rows.length === 0) {
        console.log(`📝 Running migration: ${migration.name}`);
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [migration.name]
        );
        console.log(`✅ Completed migration: ${migration.name}`);
      } else {
        console.log(`⏭️  Skipping migration: ${migration.name} (already executed)`);
      }
    }
    
    // Run seed data
    console.log('🌱 Seeding initial data...');
    for (const seed of seedData) {
      console.log(`📝 Running seed: ${seed.name}`);
      await client.query(seed.sql);
      console.log(`✅ Completed seed: ${seed.name}`);
    }
    
    // Refresh materialized views
    console.log('🔄 Refreshing materialized views...');
    await client.query('REFRESH MATERIALIZED VIEW leaderboard_global');
    await client.query('REFRESH MATERIALIZED VIEW leaderboard_weekly');
    console.log('✅ Materialized views refreshed');
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migrations
runMigrations().catch(error => {
  console.error('❌ Migration script failed:', error);
  process.exit(1);
});
