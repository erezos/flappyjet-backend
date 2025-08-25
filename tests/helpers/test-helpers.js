/**
 * 🧪 Test Helpers for Railway Backend TDD
 * Utilities for setting up test environment and data
 */

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

/**
 * Setup test database connection
 */
async function setupTestDb() {
  const testDb = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  // Ensure test tables exist
  await createTestTables(testDb);
  
  return testDb;
}

/**
 * Cleanup test database
 */
async function cleanupTestDb(db) {
  if (db) {
    await db.end();
  }
}

/**
 * Create test database tables
 */
async function createTestTables(db) {
  // Players table
  await db.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nickname VARCHAR(50),
      email VARCHAR(255),
      password_hash VARCHAR(255),
      device_id VARCHAR(255),
      platform VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Scores table
  await db.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id UUID REFERENCES players(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      survival_time INTEGER,
      skin_used VARCHAR(100),
      coins_earned INTEGER DEFAULT 0,
      gems_earned INTEGER DEFAULT 0,
      game_duration INTEGER,
      theme VARCHAR(100),
      platform VARCHAR(50),
      version VARCHAR(20),
      achieved_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Create indexes for performance
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scores_player_id ON scores(player_id);
    CREATE INDEX IF NOT EXISTS idx_scores_score_desc ON scores(score DESC);
    CREATE INDEX IF NOT EXISTS idx_scores_achieved_at ON scores(achieved_at DESC);
  `);
}

/**
 * Create a test user
 */
async function createTestUser(db, userData = {}) {
  const defaultUser = {
    id: uuidv4(),
    nickname: `TestUser_${Math.random().toString(36).substr(2, 9)}`,
    email: `test_${Math.random().toString(36).substr(2, 9)}@example.com`,
    password_hash: '$2a$10$dummy.hash.for.testing',
    device_id: uuidv4(),
    platform: 'test',
  };

  const user = { ...defaultUser, ...userData };

  const result = await db.query(`
    INSERT INTO players (id, nickname, email, password_hash, device_id, platform)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [user.id, user.nickname, user.email, user.password_hash, user.device_id, user.platform]);

  return result.rows[0];
}

/**
 * Generate JWT token for testing
 */
function generateJWT(userId, expiresIn = '1h') {
  return jwt.sign(
    { userId, type: 'test' },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn }
  );
}

/**
 * Create test score data
 */
async function createTestScore(db, playerId, scoreData = {}) {
  const defaultScore = {
    score: Math.floor(Math.random() * 1000),
    survival_time: Math.floor(Math.random() * 60000),
    skin_used: 'sky_jet',
    coins_earned: Math.floor(Math.random() * 100),
    gems_earned: 0,
    game_duration: Math.floor(Math.random() * 60000),
    theme: 'Sky Rookie',
    platform: 'test',
    version: '1.0.0',
  };

  const score = { ...defaultScore, ...scoreData };

  const result = await db.query(`
    INSERT INTO scores (
      player_id, score, survival_time, skin_used, coins_earned, 
      gems_earned, game_duration, theme, platform, version
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    playerId, score.score, score.survival_time, score.skin_used,
    score.coins_earned, score.gems_earned, score.game_duration,
    score.theme, score.platform, score.version
  ]);

  return result.rows[0];
}

/**
 * Clear test data
 */
async function clearTestData(db, tableName = null) {
  if (tableName) {
    await db.query(`DELETE FROM ${tableName} WHERE platform = 'test'`);
  } else {
    // Clear all test data
    await db.query(`DELETE FROM scores WHERE platform = 'test'`);
    await db.query(`DELETE FROM players WHERE platform = 'test'`);
  }
}

/**
 * Wait for a specified amount of time (for timing tests)
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random test data
 */
function generateRandomScoreData(overrides = {}) {
  const baseScore = Math.floor(Math.random() * 500) + 50;
  
  return {
    score: baseScore,
    survivalTime: baseScore * 100 + Math.floor(Math.random() * 10000),
    skinUsed: ['sky_jet', 'green_lightning', 'stealth_bomber'][Math.floor(Math.random() * 3)],
    coinsEarned: Math.floor(baseScore * 0.5),
    gemsEarned: Math.floor(Math.random() * 5),
    gameDuration: baseScore * 100 + Math.floor(Math.random() * 5000),
    theme: ['Sky Rookie', 'Green Lightning', 'Stealth Mode'][Math.floor(Math.random() * 3)],
    platform: 'android',
    version: '1.0.0',
    ...overrides
  };
}

/**
 * Create leaderboard test data
 */
async function createLeaderboardTestData(db, count = 10) {
  const users = [];
  const scores = [];

  for (let i = 0; i < count; i++) {
    const user = await createTestUser(db);
    users.push(user);

    const scoreData = generateRandomScoreData({
      score: (count - i) * 100 + Math.floor(Math.random() * 50) // Ensure descending order
    });

    const score = await createTestScore(db, user.id, scoreData);
    scores.push(score);
  }

  return { users, scores };
}

/**
 * Assert response structure matches expected format
 */
function assertLeaderboardResponse(response, expectedLength = null) {
  expect(response).toMatchObject({
    success: true,
    leaderboard: expect.any(Array),
    pagination: expect.objectContaining({
      limit: expect.any(Number),
      offset: expect.any(Number),
      total: expect.any(Number),
      hasMore: expect.any(Boolean)
    })
  });

  if (expectedLength !== null) {
    expect(response.leaderboard).toHaveLength(expectedLength);
  }

  // Verify leaderboard is sorted by score descending
  for (let i = 0; i < response.leaderboard.length - 1; i++) {
    expect(response.leaderboard[i].score).toBeGreaterThanOrEqual(
      response.leaderboard[i + 1].score
    );
  }

  // Verify each entry has required fields
  response.leaderboard.forEach((entry, index) => {
    expect(entry).toMatchObject({
      rank: index + 1 + (response.pagination.offset || 0),
      player_id: expect.any(String),
      nickname: expect.any(String),
      score: expect.any(Number),
      skin_used: expect.any(String),
      achieved_at: expect.any(String)
    });
  });
}

/**
 * Assert score submission response structure
 */
function assertScoreSubmissionResponse(response) {
  expect(response).toMatchObject({
    success: true,
    scoreId: expect.any(String),
    rank: expect.any(Number),
    isPersonalBest: expect.any(Boolean),
    coinsEarned: expect.any(Number),
    gemsEarned: expect.any(Number)
  });
}

/**
 * Mock Redis for testing
 */
function createMockRedis() {
  const store = new Map();
  
  return {
    get: jest.fn().mockImplementation(key => Promise.resolve(store.get(key) || null)),
    setex: jest.fn().mockImplementation((key, ttl, value) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn().mockImplementation(key => {
      const existed = store.has(key);
      store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    flushdb: jest.fn().mockImplementation(() => {
      store.clear();
      return Promise.resolve('OK');
    }),
    quit: jest.fn().mockResolvedValue('OK'),
    // Add more Redis methods as needed
    exists: jest.fn().mockImplementation(key => Promise.resolve(store.has(key) ? 1 : 0)),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
  };
}

/**
 * Performance testing helper
 */
async function measurePerformance(fn, iterations = 1) {
  const startTime = process.hrtime.bigint();
  
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  
  const endTime = process.hrtime.bigint();
  const durationMs = Number(endTime - startTime) / 1000000; // Convert to milliseconds
  
  return {
    totalTime: durationMs,
    averageTime: durationMs / iterations,
    iterations
  };
}

/**
 * Database query performance helper
 */
async function measureQueryPerformance(db, query, params = []) {
  const startTime = process.hrtime.bigint();
  const result = await db.query(query, params);
  const endTime = process.hrtime.bigint();
  
  const durationMs = Number(endTime - startTime) / 1000000;
  
  return {
    result,
    duration: durationMs,
    rowCount: result.rowCount
  };
}

module.exports = {
  setupTestDb,
  cleanupTestDb,
  createTestTables,
  createTestUser,
  generateJWT,
  createTestScore,
  clearTestData,
  wait,
  generateRandomScoreData,
  createLeaderboardTestData,
  assertLeaderboardResponse,
  assertScoreSubmissionResponse,
  createMockRedis,
  measurePerformance,
  measureQueryPerformance
};
