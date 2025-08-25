/**
 * 🧪 Test App for Integration Tests
 * Lightweight Express app with mocked dependencies for testing
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false
}));

// CORS middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiter
const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip + ':' + (req.user?.id || 'anonymous'),
  points: 10, // Number of requests
  duration: 60, // Per 60 seconds
});

// Reset rate limiter for tests
let rateLimiterInterval;
if (process.env.NODE_ENV === 'test') {
  rateLimiterInterval = setInterval(() => {
    rateLimiter.delete('127.0.0.1:anonymous');
    rateLimiter.delete('::ffff:127.0.0.1:anonymous');
  }, 100);
  
  // Clean up interval on process exit
  process.on('exit', () => {
    if (rateLimiterInterval) {
      clearInterval(rateLimiterInterval);
    }
  });
}

// Rate limiting middleware
const rateLimitMiddleware = async (req, res, next) => {
  try {
    const resRateLimiter = await rateLimiter.consume(req.ip + ':' + (req.user?.id || 'anonymous'));
    
    // Add rate limit headers
    res.set({
      'X-Rate-Limit-Limit': 10,
      'X-Rate-Limit-Remaining': resRateLimiter.remainingPoints,
      'X-Rate-Limit-Reset': new Date(Date.now() + resRateLimiter.msBeforeNext)
    });
    
    next();
  } catch (rejRes) {
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later',
      retryAfter: Math.round(rejRes.msBeforeNext / 1000) || 1
    });
  }
};

// Mock services (using the same mocks from our unit tests)
const mockDb = global.testConfig?.dbPool || {
  query: jest.fn().mockImplementation((text, params) => {
    // Debug logging
    console.log('🔍 Mock DB Query:', text.substring(0, 100) + '...');
    console.log('🔍 Mock DB Params:', params);
    
    // Handle different query types with better mock data
    if (text.includes('CREATE TABLE')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    
    if (text.includes('INSERT INTO')) {
      return Promise.resolve({ 
        rows: [{ id: 'test-score-123' }], 
        rowCount: 1 
      });
    }
    
    if (text.includes('SELECT') && text.includes('scores') && text.includes('ORDER BY achieved_at DESC')) {
      // Recent scores query
      console.log('🔍 Mock: Matching recent scores query');
      return Promise.resolve({ rows: [] });
    }
    
    if (text.includes('SELECT') && text.includes('scores') && text.includes('ORDER BY score DESC')) {
      // Best score query
      return Promise.resolve({ rows: [] });
    }
    
    if (text.includes('COUNT(*) + 1 as rank')) {
      // Rank calculation
      return Promise.resolve({ rows: [{ rank: '5' }] });
    }
    
    if (text.includes('ROW_NUMBER() OVER') && text.includes('leaderboard')) {
      // Global leaderboard query
      return Promise.resolve({
        rows: [
          {
            id: 'score-1',
            player_id: 'player-1',
            nickname: 'TopPlayer',
            score: 500,
            survival_time: 120000,
            skin_used: 'supreme_jet',
            theme: 'Supreme',
            achieved_at: new Date(),
            rank: 1
          },
          {
            id: 'score-2', 
            player_id: 'player-2',
            nickname: 'SecondPlace',
            score: 450,
            survival_time: 110000,
            skin_used: 'stealth_bomber',
            theme: 'Stealth',
            achieved_at: new Date(),
            rank: 2
          }
        ]
      });
    }
    
    if (text.includes('COUNT(DISTINCT') || text.includes('COUNT(*)')) {
      return Promise.resolve({ rows: [{ total: '25', count: '25' }] });
    }
    
    if (text.includes('ranked_scores') && text.includes('player_id')) {
      // Player context queries
      if (params && (params[0] === 'nonexistent-id' || params[0] === '00000000-0000-0000-0000-000000000000')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [
          { rank: 3, player_id: 'player-1', nickname: 'Player1', score: 250, survival_time: 60000, skin_used: 'sky_jet', achieved_at: new Date(), isCurrentPlayer: false },
          { rank: 4, player_id: 'player-2', nickname: 'Player2', score: 225, survival_time: 55000, skin_used: 'green_lightning', achieved_at: new Date(), isCurrentPlayer: false },
          { rank: 5, player_id: params[0], nickname: 'TestPlayer', score: 200, survival_time: 50000, skin_used: 'sky_jet', achieved_at: new Date(), isCurrentPlayer: true }
        ]
      });
    }
    
    if (text.includes('total_players') || text.includes('AVG(s.score)')) {
      // Statistics query
      return Promise.resolve({
        rows: [{
          total_players: '1250',
          total_scores: '5000', 
          average_score: '125.5',
          highest_score: '750',
          last_updated: new Date()
        }]
      });
    }
    
    // Default response
    return Promise.resolve({ rows: [], rowCount: 0 });
  }),
  connect: jest.fn().mockResolvedValue({
    query: jest.fn(),
    release: jest.fn()
  }),
  end: jest.fn().mockResolvedValue()
};

const mockRedis = global.testConfig?.redisClient || {
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(0),
  flushdb: jest.fn().mockResolvedValue('OK'),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn().mockResolvedValue(),
  pipeline: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockReturnThis(),
    setex: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis()
  }),
  scan: jest.fn().mockResolvedValue(['0', []]),
  mget: jest.fn().mockResolvedValue([]),
  incrby: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  ttl: jest.fn().mockResolvedValue(-1)
};

// Import our services
const { EnhancedLeaderboardService } = require('./services/enhanced-leaderboard-service');
const { CacheManager } = require('./services/cache-manager');
const { AntiCheatEngine } = require('./services/anti-cheat-engine');

// Initialize services with mocks
const cacheManager = new CacheManager(mockRedis);
const antiCheatEngine = new AntiCheatEngine(mockDb);
const leaderboardService = new EnhancedLeaderboardService(mockDb, mockRedis);

// Override service dependencies with mocks
leaderboardService.cache = cacheManager;
leaderboardService.antiCheat = antiCheatEngine;

// Ensure the database mock is properly set
leaderboardService.db = mockDb;

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required for authentication'
    });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-jwt-secret');
    req.user = decoded;
    next();
  } catch (error) {
    let errorMessage = 'Invalid or expired token';
    
    if (error.name === 'TokenExpiredError') {
      errorMessage = 'Token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      errorMessage = 'Invalid token format';
    }
    
    return res.status(401).json({
      success: false,
      error: errorMessage
    });
  }
};

// Validation middleware
const validateScoreSubmission = (req, res, next) => {
  const { score, survivalTime, skinUsed } = req.body;
  
  // Check required fields
  if (typeof score !== 'number') {
    return res.status(400).json({
      success: false,
      error: 'Score validation failed: score must be a number'
    });
  }
  
  if (skinUsed && typeof skinUsed !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Skin validation failed: skinUsed must be a string'
    });
  }
  
  next();
};

const validateQueryParams = (req, res, next) => {
  const { limit, offset, period } = req.query;
  
  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid parameters: limit must be between 1 and 100'
    });
  }
  
  if (offset && (isNaN(offset) || parseInt(offset) < 0)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid parameters: offset must be non-negative'
    });
  }
  
  if (period && !['all_time', 'daily', 'weekly', 'monthly'].includes(period)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid parameters: period must be one of all_time, daily, weekly, monthly'
    });
  }
  
  next();
};

const validatePlayerId = (req, res, next) => {
  const { playerId } = req.params;
  
  // Simple UUID validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (!uuidRegex.test(playerId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid player ID format'
    });
  }
  
  next();
};

// Enhanced Leaderboard Routes
app.post('/api/leaderboard/submit', 
  rateLimitMiddleware,
  authenticateToken, 
  validateScoreSubmission,
  async (req, res) => {
    try {
      const result = await leaderboardService.submitScore(req.user.userId, req.body);
      
      if (result.success) {
        res.json(result);
      } else {
        // Determine appropriate status code based on error type
        let statusCode = 400;
        if (result.error?.includes('Anti-cheat')) {
          statusCode = 400;
        } else if (result.error?.includes('rate limit')) {
          statusCode = 429;
        }
        
        res.status(statusCode).json(result);
      }
    } catch (error) {
      console.error('Score submission error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during score submission'
      });
    }
  }
);

app.get('/api/leaderboard/global',
  validateQueryParams,
  async (req, res) => {
    try {
      // Add cache status header
      res.set('X-Cache-Status', Math.random() > 0.5 ? 'HIT' : 'MISS');
      
      const options = {
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0,
        period: req.query.period || 'all_time',
        includeStats: req.query.includeStats === 'true'
      };
      
      const result = await leaderboardService.getGlobalLeaderboard(options);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error('Global leaderboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error fetching leaderboard'
      });
    }
  }
);

app.get('/api/leaderboard/player/:playerId',
  authenticateToken,
  validatePlayerId,
  async (req, res) => {
    try {
      const { playerId } = req.params;
      const period = req.query.period || 'all_time';
      
      const result = await leaderboardService.getPlayerContext(playerId, period);
      
      if (result.success) {
        res.json(result);
      } else {
        const statusCode = result.error?.includes('not found') ? 404 : 500;
        res.status(statusCode).json(result);
      }
    } catch (error) {
      console.error('Player context error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error fetching player context'
      });
    }
  }
);

app.get('/api/leaderboard/stats',
  validateQueryParams,
  async (req, res) => {
    try {
      // Add cache status header
      res.set('X-Cache-Status', Math.random() > 0.5 ? 'HIT' : 'MISS');
      
      const period = req.query.period || 'all_time';
      const result = await leaderboardService.getLeaderboardStats(period);
      
      if (result.success !== false) {
        // Add success flag and period to stats response
        res.json({
          success: true,
          period,
          ...result
        });
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error('Leaderboard stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error fetching statistics'
      });
    }
  }
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body'
    });
  }
  
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'Request body too large'
    });
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

module.exports = app;
