const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * Health check endpoint for monitoring
 * GET /api/health
 */
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Get database connection from app locals
    const db = req.app.locals.db;
    
    // Check database connectivity with timeout
    let dbStatus = 'disconnected';
    let dbResponseTime = 0;
    
    if (db) {
      try {
        const dbStartTime = Date.now();
        // Use a timeout promise to prevent hanging
        const queryPromise = db.query('SELECT 1');
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout')), 5000)
        );
        
        await Promise.race([queryPromise, timeoutPromise]);
        dbResponseTime = Date.now() - dbStartTime;
        dbStatus = 'connected';
      } catch (dbError) {
        dbStatus = 'error';
        logger.error('Health check - Database error:', dbError.message);
      }
    }
    
    const totalResponseTime = Date.now() - startTime;
    
    // Determine overall health status
    const isHealthy = dbStatus === 'connected';
    const statusCode = isHealthy ? 200 : 503;
    
    const healthData = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      services: {
        database: {
          status: dbStatus,
          responseTime: `${dbResponseTime}ms`,
          connectionPool: db ? 'available' : 'unavailable'
        }
      },
      performance: {
        totalResponseTime: `${totalResponseTime}ms`,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB'
        }
      }
    };
    
    // Log health check (only if unhealthy to avoid spam)
    if (!isHealthy) {
      logger.warn('Health check failed:', healthData);
    }
    
    res.status(statusCode).json(healthData);
    
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Internal server error during health check'
    });
  }
});

/**
 * Detailed health check with more comprehensive checks
 * GET /api/health/detailed
 */
router.get('/detailed', async (req, res) => {
  try {
    const startTime = Date.now();
    const db = req.app.locals.db;
    
    // Comprehensive health checks
    const checks = {
      database: { status: 'unknown', details: {} },
      memory: { status: 'unknown', details: {} },
      disk: { status: 'unknown', details: {} },
      network: { status: 'unknown', details: {} }
    };
    
    // Database check
    if (db) {
      try {
        const dbStartTime = Date.now();
        const result = await db.query(`
          SELECT 
            COUNT(*) as player_count,
            (SELECT COUNT(*) FROM player_inventory) as inventory_count,
            (SELECT COUNT(*) FROM analytics_events WHERE created_at > NOW() - INTERVAL '1 hour') as recent_events
        `);
        const dbResponseTime = Date.now() - dbStartTime;
        
        checks.database = {
          status: 'healthy',
          responseTime: `${dbResponseTime}ms`,
          details: {
            playerCount: result.rows[0].player_count,
            inventoryCount: result.rows[0].inventory_count,
            recentEvents: result.rows[0].recent_events
          }
        };
      } catch (dbError) {
        checks.database = {
          status: 'unhealthy',
          error: dbError.message
        };
      }
    } else {
      checks.database = {
        status: 'unhealthy',
        error: 'Database connection not available'
      };
    }
    
    // Memory check
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    checks.memory = {
      status: memUsagePercent < 90 ? 'healthy' : 'warning',
      details: {
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
        usagePercent: `${Math.round(memUsagePercent)}%`
      }
    };
    
    // Overall status
    const allHealthy = Object.values(checks).every(check => check.status === 'healthy');
    const hasWarnings = Object.values(checks).some(check => check.status === 'warning');
    
    const overallStatus = allHealthy ? 'healthy' : (hasWarnings ? 'warning' : 'unhealthy');
    const statusCode = allHealthy ? 200 : (hasWarnings ? 200 : 503);
    
    const detailedHealthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: `${Math.round(process.uptime())}s`,
      responseTime: `${Date.now() - startTime}ms`,
      checks: checks
    };
    
    res.status(statusCode).json(detailedHealthData);
    
  } catch (error) {
    logger.error('Detailed health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Internal server error during detailed health check'
    });
  }
});

module.exports = router;
