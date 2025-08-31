/**
 * 🧪 Test Setup for Railway Backend TDD
 * Comprehensive test environment setup with mocking and cleanup
 */

const { Pool } = require('pg');
const Redis = require('ioredis');

// Global test configuration
global.testConfig = {
  dbPool: null,
  redisClient: null,
  server: null,
  cleanup: []
};

// Mock database pool
const createMockDbPool = () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn(),
      release: jest.fn()
    }),
    end: jest.fn().mockResolvedValue(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0
  };

  // Default query responses
  mockPool.query.mockImplementation((text, params) => {
    // Handle different query types
    if (text.includes('CREATE TABLE')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    
    if (text.includes('INSERT INTO')) {
      return Promise.resolve({ 
        rows: [{ id: 'test-id-123' }], 
        rowCount: 1 
      });
    }
    
    if (text.includes('SELECT') && text.includes('scores')) {
      return Promise.resolve({
        rows: [
          {
            id: 'score-1',
            player_id: 'player-1',
            score: 150,
            survival_time: 45000,
            skin_used: 'sky_jet',
            achieved_at: new Date(),
            rank: 1
          }
        ],
        rowCount: 1
      });
    }
    
    if (text.includes('SELECT') && text.includes('players')) {
      return Promise.resolve({
        rows: [
          {
            id: 'player-1',
            nickname: 'TestPlayer',
            email: 'test@example.com',
            created_at: new Date()
          }
        ],
        rowCount: 1
      });
    }
    
    if (text.includes('COUNT')) {
      return Promise.resolve({
        rows: [{ count: '5', total: 5 }],
        rowCount: 1
      });
    }
    
    // Default response
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  return mockPool;
};

// Mock Redis client
const createMockRedis = () => {
  const store = new Map();
  
  const mockRedis = {
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
    exists: jest.fn().mockImplementation(key => Promise.resolve(store.has(key) ? 1 : 0)),
    flushdb: jest.fn().mockImplementation(() => {
      store.clear();
      return Promise.resolve('OK');
    }),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn().mockResolvedValue(),
    pipeline: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockReturnThis(),
      setex: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis()
    }),
    scan: jest.fn().mockResolvedValue(['0', []]),
    mget: jest.fn().mockImplementation((...keys) => 
      Promise.resolve(keys.map(key => store.get(key) || null))
    ),
    incrby: jest.fn().mockImplementation((key, amount) => {
      const current = parseInt(store.get(key) || '0');
      const newValue = current + amount;
      store.set(key, newValue.toString());
      return Promise.resolve(newValue);
    }),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1)
  };

  return mockRedis;
};

// Setup test environment
const setupTestEnvironment = () => {
  console.log('🧪 Setting up test environment...');
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // Use random port
  process.env.JWT_SECRET = 'test-jwt-secret-key';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
  process.env.REDIS_URL = 'redis://localhost:6379/15';
  
  // Create mock instances
  global.testConfig.dbPool = createMockDbPool();
  global.testConfig.redisClient = createMockRedis();
  
  // Mock the Pool constructor
  jest.doMock('pg', () => ({
    Pool: jest.fn().mockImplementation(() => global.testConfig.dbPool)
  }));
  
  // Mock Redis constructor
  jest.doMock('ioredis', () => {
    return jest.fn().mockImplementation(() => global.testConfig.redisClient);
  });
  
  // Mock node-cron to prevent scheduled tasks
  jest.doMock('node-cron', () => ({
    schedule: jest.fn().mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
      destroy: jest.fn()
    })
  }));
  
  console.log('🧪 Test environment setup completed');
};

// Cleanup test environment
const cleanupTestEnvironment = () => {
  console.log('🧪 Cleaning up test environment...');
  
  // Clear all timers
  jest.clearAllTimers();
  
  // Clear all mocks
  jest.clearAllMocks();
  
  // Run custom cleanup functions
  global.testConfig.cleanup.forEach(fn => {
    try {
      fn();
    } catch (error) {
      console.warn('🧪 ⚠️ Cleanup function failed:', error.message);
    }
  });
  
  global.testConfig.cleanup = [];
  
  console.log('🧪 Test environment cleaned up');
};

// Jest setup
beforeAll(() => {
  setupTestEnvironment();
});

beforeEach(() => {
  // Reset mocks before each test
  if (global.testConfig.dbPool) {
    global.testConfig.dbPool.query.mockClear();
  }
  
  if (global.testConfig.redisClient) {
    Object.keys(global.testConfig.redisClient).forEach(method => {
      if (typeof global.testConfig.redisClient[method].mockClear === 'function') {
        global.testConfig.redisClient[method].mockClear();
      }
    });
  }
});

afterEach(() => {
  cleanupTestEnvironment();
});

afterAll(() => {
  // Final cleanup
  cleanupTestEnvironment();
  
  // Close any remaining handles
  if (global.testConfig.server) {
    global.testConfig.server.close();
  }
});

// Helper functions for tests
global.testHelpers = {
  createMockDbPool,
  createMockRedis,
  mockDatabase: createMockDbPool, // Alias for backward compatibility

  // Database helpers
  mockDbQuery: (query, result) => {
    global.testConfig.dbPool.query.mockImplementationOnce(() => Promise.resolve(result));
  },

  mockDbError: (query, error) => {
    global.testConfig.dbPool.query.mockImplementationOnce(() => Promise.reject(error));
  },

  // Redis helpers
  mockRedisGet: (key, value) => {
    global.testConfig.redisClient.get.mockImplementationOnce(() => Promise.resolve(value));
  },

  mockRedisError: (method, error) => {
    global.testConfig.redisClient[method].mockImplementationOnce(() => Promise.reject(error));
  },

  // Cleanup helpers
  addCleanup: (fn) => {
    global.testConfig.cleanup.push(fn);
  },

  // Wait helper
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Authentication helpers for new JWT system
  generateTestToken: (playerData = {}) => {
    const jwt = require('jsonwebtoken');
    const payload = {
      playerId: playerData.playerId || 'test-player-id',
      username: playerData.username || 'TestPlayer',
      deviceId: playerData.deviceId || 'test-device-id',
      iat: Math.floor(Date.now() / 1000)
    };
    return jwt.sign(payload, 'test-jwt-secret-key', { expiresIn: '1h' });
  },

  createTestPlayer: async (playerData = {}) => {
    const playerId = playerData.id || 'test-player-' + Date.now();
    const deviceId = playerData.device_id || 'test-device-' + Date.now();
    const nickname = playerData.nickname || 'TestPlayer';

    // Mock database response
    global.testConfig.dbPool.query.mockImplementationOnce(() => Promise.resolve({
      rows: [{
        id: playerId,
        device_id: deviceId,
        nickname: nickname,
        created_at: new Date(),
        last_active_at: new Date()
      }],
      rowCount: 1
    }));

    return {
      id: playerId,
      device_id: deviceId,
      nickname: nickname,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString()
    };
  }
};

// Suppress console logs in tests unless explicitly needed
if (process.env.TEST_VERBOSE !== 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

console.log('🧪 Test setup completed');

module.exports = {
  setupTestEnvironment,
  cleanupTestEnvironment,
  createMockDbPool,
  createMockRedis
};