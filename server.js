/// 🚂 FlappyJet Pro - Railway Backend Server
/// Production-ready Node.js backend for mobile game

const express = require('express');
const logger = require('./utils/logger');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const http = require('http');
const Redis = require('ioredis'); // ✅ For Redis connection
// ✅ CLEANED UP: Only import services that exist and are used
const TournamentManager = require('./services/tournament-manager');
const PrizeManager = require('./services/prize-manager');
const TournamentScheduler = require('./services/tournament-scheduler');
const CacheManager = require('./services/cache-manager'); // ✅ Use CacheManager (not Simple)
const LeaderboardAggregator = require('./services/leaderboard-aggregator');
require('dotenv').config();

// ✅ CLEANED UP: Only import routes that exist and are used
const leaderboardRoutes = require('./routes/leaderboard');
const tournamentRoutes = require('./routes/tournaments');
const purchaseRoutes = require('./routes/purchase');
const healthRoutes = require('./routes/health');
const fcmRoutes = require('./routes/fcm');
const eventsRoutes = require('./routes/events'); // ✅ Event-driven architecture (PRIMARY)
const prizesV2Routes = require('./routes/prizes-v2'); // ✅ Device-based prize distribution

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Database connection
let db = null;
try {
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    
    // ✅ OPTIMIZED POOL SETTINGS FOR SCALABILITY
    max: 50,                    // Max connections (Railway Pro supports 100+)
    min: 10,                     // Keep 10 connections warm
    idleTimeoutMillis: 30000,    // Close idle connections after 30s
    connectionTimeoutMillis: 5000, // Fail fast if can't connect in 5s
    maxUses: 7500,               // Recycle connections after 7.5k uses
    allowExitOnIdle: true,       // Allow process to exit when idle
    
    // Query timeouts
    query_timeout: 10000,        // 10s max per query
    statement_timeout: 10000,    // 10s max per statement
    
    // Keep-alive for Railway
    keepAlive: true,             // Enable TCP keep-alive
    keepAliveInitialDelayMillis: 10000
  });

  // Test database connection with retry logic - Railway Pro optimized
  const connectWithRetry = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
      try {
        logger.info(`🐘 Attempting database connection ${i + 1}/${retries}...`);
        const client = await db.connect();
        
        logger.info('🐘 PostgreSQL connected successfully', { 
          host: db.options.host, 
          database: db.options.database,
          attempt: i + 1
        });
        
        // Release the test connection immediately
        client.release();
        
        // Check if tournament tables exist, if not, run migration
        try {
          await db.query('SELECT 1 FROM tournaments LIMIT 1');
          logger.info('🏆 Tournament tables already exist');
        } catch (error) {
          if (error.code === '42P01') { // Table does not exist
            logger.info('🏗️ Tournament tables not found, running auto-migration...');
            try {
              const { runMigration } = require('./scripts/migrate-tournament-schema');
              await runMigration(db);
              logger.info('🏗️ ✅ Auto-migration completed successfully');
            } catch (migrationError) {
              logger.error('🏗️ ❌ Auto-migration failed', migrationError);
              logger.warn('🚂 ⚠️ Continuing without tournament tables...');
            }
          } else {
            logger.error('🏆 ❌ Error checking tournament tables:', error);
          }
        }
        
        logger.info('🐘 ✅ Database initialization completed successfully');
        return; // Success, exit retry loop
      } catch (err) {
        logger.warn(`🐘 ⚠️ Database connection attempt ${i + 1}/${retries} failed:`, err.message);
        if (i === retries - 1) {
          logger.error('🐘 ❌ All database connection attempts failed:', err);
          logger.error('🐘 ❌ Database URL:', process.env.DATABASE_URL?.substring(0, 50) + '...');
          logger.info('🚂 ⚠️ Continuing without database for health check...');
          // Don't set db to null - keep the pool for retry attempts
        } else {
          // Wait before retry (exponential backoff)
          const delay = Math.pow(2, i) * 2000; // Start with 2 seconds
          logger.info(`🐘 ⚠️ Retrying in ${delay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  };
  
  // Start connection with retry (non-blocking)
  connectWithRetry().catch(err => {
    logger.error('🐘 ❌ Database connection retry failed:', err);
  });
  
  // Add connection pool monitoring
  db.on('error', (err) => {
    logger.error('🐘 ❌ Database pool error:', err);
  });
  
  db.on('connect', (client) => {
    logger.debug('🐘 ✅ New client connected to database');
  });
  
  db.on('remove', (client) => {
    logger.debug('🐘 ❌ Client removed from database pool');
  });
  
  // Set database in app locals for health check access
  app.locals.db = db;
  logger.info('🐘 ✅ Database pool set in app.locals for health checks');
  
} catch (error) {
  logger.error('🐘 ❌ Database initialization error:', error);
  logger.info('🚂 ⚠️ Continuing without database for health check...');
  app.locals.db = null;
}

// ✅ CLEANED UP: Only initialize services that exist and are used
let tournamentManager = null;
let prizeManager = null;
let tournamentScheduler = null;
let cacheManager = null;
let redisClient = null;

// ✅ ASYNC SERVICE INITIALIZATION - Wrap in async IIFE to handle Redis properly
(async () => {
  // Initialize services only if database is available
  if (db) {
    logger.info('🔧 Starting service initialization...');
    
    // Initialize Redis Client (optional, graceful degradation)
    try {
      const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;
      
      if (redisUrl) {
        logger.info('💾 Redis URL found, initializing client...', { url: redisUrl?.substring(0, 20) + '...' });
        redisClient = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true, // ✅ Check if connection is ready
          lazyConnect: false, // ✅ Connect immediately
          connectTimeout: 10000, // ✅ Increased timeout for Railway network
          retryStrategy: (times) => {
            if (times > 5) {
              logger.error('💾 ❌ Redis: Max retry attempts reached');
              return null; // Stop retrying
            }
            const delay = Math.min(times * 200, 2000);
            logger.info(`💾 🔄 Redis retry attempt ${times}, waiting ${delay}ms...`);
            return delay;
          }
        });
        
        redisClient.on('connect', () => {
          logger.info('💾 🔌 Redis connection initiated...');
        });
        
        redisClient.on('ready', () => {
          logger.info('💾 ✅ Redis connected and READY!');
        });
        
        redisClient.on('error', (err) => {
          logger.error('💾 ❌ Redis error:', err.message);
          // Don't crash the server
        });
        
        redisClient.on('close', () => {
          logger.warn('💾 ⚠️ Redis connection closed');
        });
        
        redisClient.on('reconnecting', () => {
          logger.info('💾 🔄 Redis reconnecting...');
        });
        
        // ✅ WAIT for Redis to be ready or timeout after 10 seconds
        try {
          await Promise.race([
            new Promise((resolve) => {
              if (redisClient.status === 'ready') {
                resolve();
              } else {
                redisClient.once('ready', resolve);
              }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 10000))
          ]);
          logger.info('💾 ✅ Redis client initialized and ready');
        } catch (waitError) {
          logger.error('💾 ❌ Redis ready check failed:', waitError.message);
          logger.warn('💾 ⚠️ Continuing without Redis (will retry in background)');
          // Keep the client for background reconnection, but don't wait
        }
      } else {
        logger.warn('💾 ⚠️ No Redis URL configured, running without Redis');
        redisClient = null;
      }
    } catch (error) {
      logger.error('💾 ❌ Redis initialization failed:', error.message);
      logger.warn('💾 ⚠️ Continuing without Redis (dashboard will not have caching)');
      redisClient = null;
    }
    
    // Initialize Cache Manager (with or without Redis)
    try {
      if (redisClient && redisClient.status === 'ready') {
        cacheManager = new CacheManager(redisClient);
        logger.info('💾 ✅ Cache Manager initialized (with Redis)');
      } else {
        // Create a no-op cache manager for graceful degradation
        cacheManager = {
          get: async () => null,
          set: async () => true,
          delete: async () => true,
          redis: null
        };
        logger.warn('💾 ⚠️ Cache Manager initialized (no-op mode, no Redis)');
      }
    } catch (error) {
      logger.error('💾 ❌ Cache Manager failed:', error.message);
      // Create no-op fallback
      cacheManager = {
        get: async () => null,
        set: async () => true,
        delete: async () => true,
        redis: null
      };
    }
    
    // ✅ Initialize dashboard API routes (needs cacheManager)
    try {
      const dashboardApiRoutes = require('./routes/dashboard-api')(db, cacheManager);
      app.use('/api/dashboard', dashboardApiRoutes);
      logger.info('📊 ✅ Analytics Dashboard API initialized');
    } catch (error) {
      logger.error('📊 ❌ Analytics Dashboard API failed:', error.message);
    }
    
    // Initialize Event-Driven Aggregators
    let leaderboardAggregator = null;
    
    try {
      leaderboardAggregator = new LeaderboardAggregator(db, cacheManager);
      app.locals.leaderboardAggregator = leaderboardAggregator;
      logger.info('📊 ✅ Leaderboard Aggregator initialized');
    } catch (error) {
      logger.error('📊 ❌ Leaderboard Aggregator failed:', error.message);
    }
    
    // Initialize Prize Manager
    try {
      prizeManager = new PrizeManager({ db, wsManager: null }); // ✅ No WebSocket manager
      app.locals.prizeManager = prizeManager;
      logger.info('🏆 ✅ Prize Manager initialized');
    } catch (error) {
      logger.error('🏆 ❌ Prize Manager failed:', error.message);
    }
    
    // Initialize Tournament Manager
    try {
      tournamentManager = new TournamentManager({ 
        db, 
        cacheManager, 
        prizeManager, 
        wsManager: null, // ✅ No WebSocket manager
        leaderboardManager: null // ✅ No separate leaderboard manager
      });
      app.locals.tournamentManager = tournamentManager;
      logger.info('🏆 ✅ Tournament Manager initialized');
    } catch (error) {
      logger.error('🏆 ❌ Tournament Manager failed:', error.message);
      logger.error('🏆 ❌ Error details:', error);
    }
    
    // Initialize Tournament Scheduler
    try {
      tournamentScheduler = new TournamentScheduler({ 
        db, 
        tournamentManager, 
        wsManager: null // ✅ No WebSocket manager
      });
      tournamentScheduler.start();
      app.locals.tournamentScheduler = tournamentScheduler;
      logger.info('🏆 ✅ Tournament Scheduler started');
    } catch (error) {
      logger.error('🏆 ❌ Tournament Scheduler failed:', error.message);
    }
    
    logger.info('🔧 ✅ Service initialization completed');
  } else {
    logger.info('🚂 ⚠️ Database not available, running in minimal mode');
  }
})().catch(err => {
  logger.error('🚨 ❌ CRITICAL: Service initialization failed:', err);
  // Don't crash the server, but log the error
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://flappyjet.pro', 'https://www.flappyjet.pro']
    : true,
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const { RateLimiterMemory } = require('rate-limiter-flexible');
const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
});

const rateLimitMiddleware = (req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).json({ error: 'Too many requests' }));
};

app.use(rateLimitMiddleware);

// ✅ Serve static files from 'public' directory (for dashboard.html)
app.use(express.static(path.join(__dirname, 'public')));

// Initialize production dashboard service
const DashboardService = require('./services/dashboard-service');
const dashboardService = new DashboardService(db, logger);

// Initialize dashboard routes
dashboardService.initializeRoutes(app);

// Health check endpoint
app.get('/health', (req, res) => {
  logger.info('🏥 Health check requested');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0', // ✅ Updated version
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      database: !!db,
      cache: !!cacheManager,
      tournament: !!tournamentManager,
      scheduler: !!tournamentScheduler
    }
  });
});

// Migration endpoint removed for security

// ✅ Services are now set in app.locals inside the async IIFE above (lines 154-323)
// This ensures proper async initialization of Redis and all services

// API Routes (only if database is available)
if (db) {
  // ✅ Event-driven architecture (PRIMARY - what Flutter app uses)
  app.use('/api/events', eventsRoutes);
  
  // ✅ V2 Routes - Device-based (no auth required)
  app.use('/api/v2/prizes', prizesV2Routes);
  
  // ✅ Existing routes (still supported)
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api/purchase', purchaseRoutes(db));
  app.use('/api/health', healthRoutes);
  app.use('/api/fcm', fcmRoutes(db));

  logger.info('🚂 ✅ All API routes initialized (event-driven architecture)');
} else {
  // Minimal routes for health check
  app.get('/api/*', (req, res) => {
    res.status(503).json({ 
      error: 'Service temporarily unavailable - database not connected',
      path: req.originalUrl 
    });
  });
  logger.info('🚂 ⚠️ API routes disabled - database not available');
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '🚂 FlappyJet Pro Backend API',
    version: '2.0.0',
    architecture: 'Event-driven + Device-based Identity',
    endpoints: {
      health: '/health',
      events: '/api/events/*', // PRIMARY: All game events
      tournaments: '/api/tournaments/*',
      leaderboard: '/api/leaderboard/*',
      prizes: '/api/v2/prizes/*',
      purchase: '/api/purchase/*',
      fcm: '/api/fcm/*',
      dashboard: '/dashboard'
    },
    documentation: 'https://github.com/flappyjet/backend-docs'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('🚨 Server Error:', err);
  
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Scheduled tasks
// Reset daily missions at midnight UTC
cron.schedule('0 0 * * *', async () => {
  logger.info('🎯 Running daily missions reset...');
  try {
    await db.query(`
      UPDATE player_missions 
      SET completed = false, progress = 0, completed_at = NULL
      WHERE mission_type IN ('daily_play', 'daily_score', 'daily_streak')
      AND DATE(created_at) < CURRENT_DATE
    `);
    logger.info('🎯 ✅ Daily missions reset completed');
  } catch (error) {
    logger.error('🎯 ❌ Daily missions reset failed:', error);
  }
});

// Cleanup old analytics data (keep 90 days)
cron.schedule('0 2 * * 0', async () => {
  logger.info('🧹 Running weekly cleanup...');
  try {
    await db.query(`
      DELETE FROM analytics_events 
      WHERE created_at < NOW() - INTERVAL '90 days'
    `);
    logger.info('🧹 ✅ Weekly cleanup completed');
  } catch (error) {
    logger.error('🧹 ❌ Weekly cleanup failed:', error);
  }
});

// ============================================================================
// EVENT-DRIVEN ARCHITECTURE CRON JOBS
// ============================================================================

// 🏆 Update global leaderboard from game_ended events (every 10 minutes)
if (db) {
  cron.schedule('*/10 * * * *', async () => {
    try {
      logger.info('🏆 Cron: Updating global leaderboard from events...');
      const leaderboardAggregator = app.locals.leaderboardAggregator;
      
      if (leaderboardAggregator) {
        const result = await leaderboardAggregator.updateGlobalLeaderboard();
        if (result.success) {
          logger.info(`🏆 ✅ Global leaderboard updated: ${result.processed} events processed`);
        } else {
          logger.error(`🏆 ❌ Global leaderboard update failed: ${result.error}`);
        }
      }
    } catch (error) {
      logger.error('🏆 ❌ Global leaderboard cron failed:', error);
    }
  });
  logger.info('🏆 Cron job registered: Global leaderboard update (every 10 minutes)');
}

// 🏆 Update tournament leaderboard from game_ended events (every 4 minutes)
if (db && tournamentManager) {
  cron.schedule('*/4 * * * *', async () => {
    try {
      logger.info('🏆 Cron: Updating tournament leaderboard from events...');
      
      // Get current tournament
      const tournament = await tournamentManager.getCurrentTournament();
      
      if (tournament.success && tournament.tournament) {
        const leaderboardAggregator = app.locals.leaderboardAggregator;
        
        if (leaderboardAggregator) {
          const result = await leaderboardAggregator.updateTournamentLeaderboard(
            tournament.tournament.tournament_id,
            tournament.tournament.start_date,
            tournament.tournament.end_date
          );
          
          if (result.success) {
            logger.info(`🏆 ✅ Tournament leaderboard updated: ${result.processed} events processed`);
          } else {
            logger.error(`🏆 ❌ Tournament leaderboard update failed: ${result.error}`);
          }
        }
      }
    } catch (error) {
      logger.error('🏆 ❌ Tournament leaderboard cron failed:', error);
    }
  });
  logger.info('🏆 Cron job registered: Tournament leaderboard update (every 4 minutes)');
}

// 🧹 Cleanup old events (keep 90 days) - runs weekly on Sunday at 3 AM
if (db) {
  cron.schedule('0 3 * * 0', async () => {
    try {
      logger.info('🧹 Cron: Cleaning up old events (>90 days)...');
      
      const result = await db.query(`
        DELETE FROM events 
        WHERE received_at < NOW() - INTERVAL '90 days'
          AND processed_at IS NOT NULL
        RETURNING id
      `);
      
      logger.info(`🧹 ✅ Cleaned up ${result.rowCount} old events`);
    } catch (error) {
      logger.error('🧹 ❌ Event cleanup failed:', error);
    }
  });
  logger.info('🧹 Cron job registered: Old events cleanup (weekly, Sunday 3 AM)');
}

// ============================================================================
// END EVENT-DRIVEN CRON JOBS
// ============================================================================

// Dashboard views refresh (twice daily: 6 AM and 6 PM UTC)
cron.schedule('0 6,18 * * *', async () => {
  logger.info('📊 Running dashboard views refresh...');
  try {
    const { refreshDashboardViews } = require('./scripts/refresh-dashboard-views');
    await refreshDashboardViews();
    logger.info('📊 ✅ Dashboard views refresh completed');
  } catch (error) {
    logger.error('📊 ❌ Dashboard views refresh failed:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('🚂 Received SIGTERM, shutting down gracefully...');
  
  // Stop Tournament Scheduler
  if (tournamentScheduler) {
    tournamentScheduler.stop();
  }
  
  // Close Redis connection
  if (redisClient) {
    await redisClient.quit();
    logger.info('💾 ✅ Redis connection closed');
  }
  
  // Close database connection
  if (db) {
    await db.end();
  }
  
  // Close HTTP server
  server.close(() => {
    logger.info('🚂 ✅ Server shutdown complete');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('🚂 Received SIGINT, shutting down gracefully...');
  
  // Stop Tournament Scheduler
  if (tournamentScheduler) {
    tournamentScheduler.stop();
  }
  
  // Close Redis connection
  if (redisClient) {
    logger.info('💾 Closing Redis connection...');
    try {
      await redisClient.quit();
      logger.info('💾 ✅ Redis connection closed');
    } catch (error) {
      logger.error('💾 ❌ Error closing Redis:', error);
    }
  }
  
  // Close database connection gracefully
  if (db) {
    logger.info('🐘 Closing database connection pool...');
    try {
      await db.end();
      logger.info('🐘 ✅ Database connection pool closed');
    } catch (error) {
      logger.error('🐘 ❌ Error closing database pool:', error);
    }
  }
  
  // Close HTTP server
  server.close(() => {
    logger.info('🚂 ✅ Server shutdown complete');
    process.exit(0);
  });
});

// Start server with error handling
try {
  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚂 ✅ FlappyJet Pro Backend running on port ${PORT}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`📊 Health check: http://localhost:${PORT}/health`);
    logger.info(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    logger.info(`🎮 Event API: http://localhost:${PORT}/api/events`);
    logger.info(`🚀 Railway deployment ready!`);
  });

  server.on('error', (error) => {
    logger.error('🚨 Server startup error:', error);
    if (error.code === 'EADDRINUSE') {
      logger.error(`❌ Port ${PORT} is already in use`);
    } else if (error.code === 'EACCES') {
      logger.error(`❌ Permission denied for port ${PORT}`);
    }
    process.exit(1);
  });

} catch (error) {
  logger.error('🚨 Fatal server error:', error);
  process.exit(1);
}

module.exports = app;
