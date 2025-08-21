/// 🧪 Test Setup - Global configuration for FlappyJet Backend tests
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.test' });

// Global test configuration
global.testConfig = {
  dbPool: null,
  server: null,
  testUser: null,
  authToken: null,
};

// Test database setup
const setupTestDatabase = async () => {
  // Use test database URL or create in-memory database
  const testDbUrl = process.env.TEST_DATABASE_URL || 
    'postgresql://test:test@localhost:5432/flappyjet_test';
  
  global.testConfig.dbPool = new Pool({
    connectionString: testDbUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  try {
    await global.testConfig.dbPool.connect();
    console.log('🧪 Test database connected');
  } catch (error) {
    console.warn('🧪 ⚠️ Test database connection failed, using mocks:', error.message);
    global.testConfig.dbPool = null;
  }
};

// Clean database between tests
const cleanDatabase = async () => {
  if (!global.testConfig.dbPool) return;
  
  try {
    // Clean all tables in reverse dependency order
    await global.testConfig.dbPool.query('TRUNCATE TABLE analytics_events CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE purchases CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE player_achievements CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE achievements CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE player_missions CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE missions_templates CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE player_inventory CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE scores CASCADE');
    await global.testConfig.dbPool.query('TRUNCATE TABLE players CASCADE');
    
    // Refresh materialized views
    await global.testConfig.dbPool.query('REFRESH MATERIALIZED VIEW leaderboard_global');
    await global.testConfig.dbPool.query('REFRESH MATERIALIZED VIEW leaderboard_weekly');
  } catch (error) {
    console.warn('🧪 ⚠️ Database cleanup failed:', error.message);
  }
};

// Seed test data
const seedTestData = async () => {
  if (!global.testConfig.dbPool) return;
  
  try {
    // Insert test achievements
    await global.testConfig.dbPool.query(`
      INSERT INTO achievements (id, category, rarity, title, description, target, reward_coins, reward_gems) VALUES
      ('test_achievement_1', 'score', 'common', 'Test Achievement 1', 'Test description 1', 10, 100, 5),
      ('test_achievement_2', 'survival', 'rare', 'Test Achievement 2', 'Test description 2', 60, 200, 10)
      ON CONFLICT (id) DO NOTHING
    `);
    
    // Insert test mission templates
    await global.testConfig.dbPool.query(`
      INSERT INTO missions_templates (mission_type, difficulty_level, title_template, description_template, base_target, base_reward) VALUES
      ('play_games', 'easy', 'Test Mission', 'Play {target} games', 3, 75),
      ('reach_score', 'medium', 'Score Mission', 'Reach {target} points', 10, 150)
      ON CONFLICT DO NOTHING
    `);
    
    console.log('🧪 Test data seeded');
  } catch (error) {
    console.warn('🧪 ⚠️ Test data seeding failed:', error.message);
  }
};

// Create test user
const createTestUser = async () => {
  if (!global.testConfig.dbPool) return;
  
  try {
    const result = await global.testConfig.dbPool.query(`
      INSERT INTO players (device_id, nickname, platform, app_version)
      VALUES ('test_device_123', 'TestPlayer', 'test', '1.0.0')
      RETURNING *
    `);
    
    global.testConfig.testUser = result.rows[0];
    console.log('🧪 Test user created:', global.testConfig.testUser.id);
  } catch (error) {
    console.warn('🧪 ⚠️ Test user creation failed:', error.message);
  }
};

// Setup before all tests
beforeAll(async () => {
  console.log('🧪 Setting up test environment...');
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-key';
  process.env.PORT = '0'; // Use random available port
  
  await setupTestDatabase();
  await seedTestData();
});

// Setup before each test
beforeEach(async () => {
  await cleanDatabase();
  await createTestUser();
  
  // Reset global test state
  global.testConfig.authToken = null;
});

// Cleanup after all tests
afterAll(async () => {
  console.log('🧪 Cleaning up test environment...');
  
  if (global.testConfig.dbPool) {
    await global.testConfig.dbPool.end();
  }
  
  if (global.testConfig.server) {
    await global.testConfig.server.close();
  }
});

// Helper functions for tests
global.testHelpers = {
  // Generate test JWT token
  generateTestToken: (playerId) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign({ playerId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  },
  
  // Create test player
  createTestPlayer: async (overrides = {}) => {
    if (!global.testConfig.dbPool) return null;
    
    const playerData = {
      device_id: `test_device_${Date.now()}`,
      nickname: 'TestPlayer',
      platform: 'test',
      app_version: '1.0.0',
      ...overrides
    };
    
    const result = await global.testConfig.dbPool.query(`
      INSERT INTO players (device_id, nickname, platform, app_version)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [playerData.device_id, playerData.nickname, playerData.platform, playerData.app_version]);
    
    return result.rows[0];
  },
  
  // Create test score
  createTestScore: async (playerId, scoreData = {}) => {
    if (!global.testConfig.dbPool) return null;
    
    const score = {
      score: 42,
      survival_time: 30,
      skin_used: 'sky_jet',
      coins_earned: 15,
      gems_earned: 2,
      game_duration: 30000,
      ...scoreData
    };
    
    const result = await global.testConfig.dbPool.query(`
      INSERT INTO scores (player_id, score, survival_time, skin_used, coins_earned, gems_earned, game_duration)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [playerId, score.score, score.survival_time, score.skin_used, score.coins_earned, score.gems_earned, score.game_duration]);
    
    return result.rows[0];
  },
  
  // Create test mission
  createTestMission: async (playerId, missionData = {}) => {
    if (!global.testConfig.dbPool) return null;
    
    const mission = {
      mission_type: 'play_games',
      difficulty_level: 'easy',
      title: 'Test Mission',
      description: 'Test mission description',
      target: 5,
      reward: 100,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      ...missionData
    };
    
    const result = await global.testConfig.dbPool.query(`
      INSERT INTO player_missions (player_id, mission_type, difficulty_level, title, description, target, reward, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [playerId, mission.mission_type, mission.difficulty_level, mission.title, mission.description, mission.target, mission.reward, mission.expires_at]);
    
    return result.rows[0];
  },
  
  // Wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Mock database for tests without real DB
  mockDatabase: () => {
    const mockQuery = jest.fn();
    return {
      query: mockQuery,
      connect: jest.fn().mockResolvedValue({}),
      end: jest.fn().mockResolvedValue({}),
      mockQuery
    };
  }
};

// Custom matchers
expect.extend({
  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },
  
  toBeValidJWT(received) {
    const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    const pass = jwtRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid JWT`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid JWT`,
        pass: false,
      };
    }
  },
  
  toHaveValidTimestamp(received) {
    const timestamp = new Date(received);
    const pass = !isNaN(timestamp.getTime());
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid timestamp`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid timestamp`,
        pass: false,
      };
    }
  }
});

console.log('🧪 Test setup completed');
