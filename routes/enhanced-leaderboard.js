/**
 * 🏆 Enhanced Leaderboard Routes - Production Ready
 * TDD-tested routes with comprehensive validation and error handling
 */

const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { EnhancedLeaderboardService } = require('../services/enhanced-leaderboard-service');
const { CacheManager } = require('../services/cache-manager');
const { AntiCheatEngine } = require('../services/anti-cheat-engine');

const router = express.Router();

// Initialize database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Initialize Redis connection
let redis = null;
try {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
} catch (error) {
  console.warn('🔴 Redis connection failed, running without cache:', error.message);
}

// Initialize services
const cacheManager = redis ? new CacheManager(redis) : null;
const antiCheatEngine = new AntiCheatEngine(db);
const leaderboardService = new EnhancedLeaderboardService(db, redis);

// Inject dependencies
if (cacheManager) {
  leaderboardService.cache = cacheManager;
}
leaderboardService.antiCheat = antiCheatEngine;

// Middleware for authentication (reuse existing auth middleware)
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
  
  if (typeof score !== 'number' || score < 0) {
    return res.status(400).json({
      success: false,
      error: 'Score validation failed: score must be a non-negative number'
    });
  }
  
  if (survivalTime !== undefined && (typeof survivalTime !== 'number' || survivalTime < 0)) {
    return res.status(400).json({
      success: false,
      error: 'Survival time validation failed: must be a non-negative number'
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
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (!uuidRegex.test(playerId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid player ID format'
    });
  }
  
  next();
};

/**
 * 📤 POST /api/leaderboard/enhanced/submit
 * Enhanced score submission with anti-cheat and caching
 */
router.post('/submit', authenticateToken, validateScoreSubmission, async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Extract player ID from JWT token
    const playerId = req.user.userId || req.user.id;
    
    if (!playerId) {
      return res.status(400).json({
        success: false,
        error: 'Player ID not found in authentication token'
      });
    }

    // Submit score using enhanced service
    const result = await leaderboardService.submitScore(playerId, req.body);
    
    // Add performance metrics
    const processingTime = Date.now() - startTime;
    result.processingTime = processingTime;
    
    if (result.success) {
      // Add cache headers
      res.set({
        'X-Processing-Time': `${processingTime}ms`,
        'X-Enhanced-Leaderboard': 'v1.0'
      });
      
      res.json(result);
    } else {
      // Determine appropriate status code
      let statusCode = 400;
      if (result.error?.includes('Anti-cheat')) {
        statusCode = 400;
      } else if (result.error?.includes('rate limit')) {
        statusCode = 429;
      }
      
      res.status(statusCode).json(result);
    }
  } catch (error) {
    console.error('🚂 ❌ Enhanced score submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during score submission'
    });
  }
});

/**
 * 📊 GET /api/leaderboard/enhanced/global
 * Enhanced global leaderboard with caching and statistics
 */
router.get('/global', validateQueryParams, async (req, res) => {
  try {
    const startTime = Date.now();
    
    const options = {
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
      period: req.query.period || 'all_time',
      includeStats: req.query.includeStats === 'true'
    };
    
    const result = await leaderboardService.getGlobalLeaderboard(options);
    
    if (result.success) {
      // Add performance and cache headers
      const processingTime = Date.now() - startTime;
      res.set({
        'X-Processing-Time': `${processingTime}ms`,
        'X-Cache-Status': result.fromCache ? 'HIT' : 'MISS',
        'X-Enhanced-Leaderboard': 'v1.0'
      });
      
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('🚂 ❌ Enhanced global leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching leaderboard'
    });
  }
});

/**
 * 🎯 GET /api/leaderboard/enhanced/player/:playerId
 * Enhanced player context with surrounding players
 */
router.get('/player/:playerId', authenticateToken, validatePlayerId, async (req, res) => {
  try {
    const startTime = Date.now();
    const { playerId } = req.params;
    const period = req.query.period || 'all_time';
    const contextSize = parseInt(req.query.contextSize) || 5;
    
    const result = await leaderboardService.getPlayerContext(playerId, period, contextSize);
    
    if (result.success) {
      // Add performance headers
      const processingTime = Date.now() - startTime;
      res.set({
        'X-Processing-Time': `${processingTime}ms`,
        'X-Enhanced-Leaderboard': 'v1.0'
      });
      
      res.json(result);
    } else {
      const statusCode = result.error?.includes('not found') ? 404 : 500;
      res.status(statusCode).json(result);
    }
  } catch (error) {
    console.error('🚂 ❌ Enhanced player context error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching player context'
    });
  }
});

/**
 * 📈 GET /api/leaderboard/enhanced/stats
 * Enhanced leaderboard statistics with caching
 */
router.get('/stats', validateQueryParams, async (req, res) => {
  try {
    const startTime = Date.now();
    const period = req.query.period || 'all_time';
    
    const result = await leaderboardService.getLeaderboardStats(period);
    
    if (result.success !== false) {
      // Add performance and cache headers
      const processingTime = Date.now() - startTime;
      res.set({
        'X-Processing-Time': `${processingTime}ms`,
        'X-Cache-Status': result.fromCache ? 'HIT' : 'MISS',
        'X-Enhanced-Leaderboard': 'v1.0'
      });
      
      res.json({
        success: true,
        period,
        ...result
      });
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('🚂 ❌ Enhanced leaderboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching statistics'
    });
  }
});

/**
 * 🛡️ GET /api/leaderboard/enhanced/anti-cheat/stats
 * Anti-cheat statistics (admin only)
 */
router.get('/anti-cheat/stats', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges (implement your admin check logic)
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    const days = parseInt(req.query.days) || 7;
    const result = await antiCheatEngine.getAntiCheatStats(days);
    
    res.json(result);
  } catch (error) {
    console.error('🚂 ❌ Anti-cheat stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching anti-cheat statistics'
    });
  }
});

/**
 * 🔍 GET /api/leaderboard/enhanced/player/:playerId/cheat-history
 * Player cheat detection history (admin only)
 */
router.get('/player/:playerId/cheat-history', authenticateToken, validatePlayerId, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    const { playerId } = req.params;
    const days = parseInt(req.query.days) || 30;
    
    const result = await antiCheatEngine.getPlayerCheatHistory(playerId, days);
    
    res.json(result);
  } catch (error) {
    console.error('🚂 ❌ Player cheat history error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching cheat history'
    });
  }
});

/**
 * 💾 GET /api/leaderboard/enhanced/cache/stats
 * Cache performance statistics (admin only)
 */
router.get('/cache/stats', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    if (!cacheManager) {
      return res.json({
        success: true,
        message: 'Cache not available',
        stats: null
      });
    }
    
    const stats = cacheManager.getStats();
    const healthCheck = await cacheManager.healthCheck();
    
    res.json({
      success: true,
      stats,
      healthCheck
    });
  } catch (error) {
    console.error('🚂 ❌ Cache stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching cache statistics'
    });
  }
});

/**
 * 🔄 POST /api/leaderboard/enhanced/cache/clear
 * Clear leaderboard cache (admin only)
 */
router.post('/cache/clear', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    if (!cacheManager) {
      return res.json({
        success: true,
        message: 'Cache not available'
      });
    }
    
    const cleared = await cacheManager.clear();
    
    res.json({
      success: true,
      message: `Cleared ${cleared} cache entries`
    });
  } catch (error) {
    console.error('🚂 ❌ Cache clear error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error clearing cache'
    });
  }
});

/**
 * 🌐 GET /api/leaderboard/enhanced/websocket/stats
 * WebSocket connection statistics (admin only)
 */
router.get('/websocket/stats', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    // Get WebSocket manager from global scope (we'll need to pass this in)
    const wsManager = req.app.locals.wsManager;
    
    if (!wsManager) {
      return res.json({
        success: true,
        message: 'WebSocket not available',
        stats: null
      });
    }
    
    const stats = wsManager.getStats();
    const clients = wsManager.getClients();
    
    res.json({
      success: true,
      stats,
      clients,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚂 ❌ WebSocket stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching WebSocket statistics'
    });
  }
});

/**
 * 🌐 POST /api/leaderboard/enhanced/websocket/broadcast
 * Broadcast message to WebSocket clients (admin only)
 */
router.post('/websocket/broadcast', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    const { room, message, type = 'admin_message' } = req.body;
    
    if (!room || !message) {
      return res.status(400).json({
        success: false,
        error: 'Room and message are required'
      });
    }
    
    const wsManager = req.app.locals.wsManager;
    
    if (!wsManager) {
      return res.json({
        success: true,
        message: 'WebSocket not available'
      });
    }
    
    const sentCount = wsManager.broadcastToRoom(room, {
      type,
      message,
      from: 'admin',
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      sentCount,
      room,
      message: `Broadcasted to ${sentCount} clients`
    });
  } catch (error) {
    console.error('🚂 ❌ WebSocket broadcast error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error broadcasting message'
    });
  }
});

/**
 * 📊 GET /api/leaderboard/enhanced/metrics
 * Performance metrics and monitoring data (admin only)
 */
router.get('/metrics', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    const monitoringService = req.app.locals.monitoringService;
    
    if (!monitoringService) {
      return res.json({
        success: true,
        message: 'Monitoring not available',
        metrics: null
      });
    }
    
    const metrics = monitoringService.getMetrics();
    
    res.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚂 ❌ Metrics error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching metrics'
    });
  }
});

/**
 * 📊 GET /api/leaderboard/enhanced/performance
 * Detailed performance report (admin only)
 */
router.get('/performance', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    const monitoringService = req.app.locals.monitoringService;
    
    if (!monitoringService) {
      return res.json({
        success: true,
        message: 'Monitoring not available',
        report: null
      });
    }
    
    const report = await monitoringService.getPerformanceReport();
    
    res.json({
      success: true,
      report,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚂 ❌ Performance report error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error generating performance report'
    });
  }
});

/**
 * 🚨 GET /api/leaderboard/enhanced/alerts
 * System alerts and warnings (admin only)
 */
router.get('/alerts', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    const monitoringService = req.app.locals.monitoringService;
    
    if (!monitoringService) {
      return res.json({
        success: true,
        message: 'Monitoring not available',
        alerts: []
      });
    }
    
    const alerts = monitoringService.getAlerts();
    
    res.json({
      success: true,
      alerts,
      count: alerts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('🚂 ❌ Alerts error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error fetching alerts'
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
        cache: 'unknown',
        antiCheat: 'healthy'
      }
    };
    
    // Check database connection
    try {
      await db.query('SELECT 1');
      health.services.database = 'healthy';
    } catch (error) {
      health.services.database = 'unhealthy';
      health.status = 'degraded';
    }
    
    // Check cache connection
    if (cacheManager) {
      const cacheHealth = await cacheManager.healthCheck();
      health.services.cache = cacheHealth.status;
      if (cacheHealth.status !== 'healthy') {
        health.status = 'degraded';
      }
    } else {
      health.services.cache = 'unavailable';
    }
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    console.error('🚂 ❌ Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
