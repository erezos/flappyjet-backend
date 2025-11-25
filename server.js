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
const NotificationScheduler = require('./services/notification-scheduler');
const { CacheManager } = require('./services/cache-manager'); // ✅ Named export - destructure it!
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
const notificationsRoutes = require('./routes/notifications'); // ✅ Push notifications (FCM V1 API)

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
      // ✅ Railway provides both REDIS_URL and individual variables (REDISHOST, REDISPORT, etc.)
      // Try individual variables first (more reliable for Railway), then fall back to URL
      const redisHost = process.env.REDISHOST;
      const redisPort = process.env.REDISPORT;
      const redisUser = process.env.REDISUSER;
      const redisPassword = process.env.REDISPASSWORD;
      const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;
      
      const commonOptions = {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false, // Connect immediately
        connectTimeout: 30000,
        retryStrategy: (times) => {
          if (times > 20) {
            logger.error('💾 ❌ Redis: Max retry attempts reached (20)');
            return null;
          }
          const delay = Math.min(times * 200, 2000);
          logger.info(`💾 🔄 Redis retry attempt ${times}/20, waiting ${delay}ms...`);
          return delay;
        }
      };
      
      // ✅ METHOD 1: Use individual Railway variables (preferred for Railway)
      if (redisHost && redisPort) {
        logger.info('💾 Redis connection using Railway individual variables', {
          host: redisHost,
          port: redisPort,
          hasUser: !!redisUser,
          hasPassword: !!redisPassword
        });
        
        redisClient = new Redis({
          host: redisHost,
          port: parseInt(redisPort, 10),
          username: redisUser || undefined,
          password: redisPassword || undefined,
          // ✅ Railway uses IPv6 - enable IPv6 support
          family: 0, // 0 = IPv4 and IPv6 (dual-stack)
          ...commonOptions
        });
      }
      // ✅ METHOD 2: Fall back to REDIS_URL (if individual vars not available)
      else if (redisUrl) {
        logger.info('💾 Redis connection using REDIS_URL', {
          url: redisUrl?.substring(0, 30) + '...',
          hasUrl: !!redisUrl
        });
        
        // ✅ Parse URL and add IPv6 support
        const redisUrlWithIPv6 = redisUrl.includes('?') 
          ? `${redisUrl}&family=0` 
          : `${redisUrl}?family=0`;
        
        // Create Redis instance with URL and options
        redisClient = new Redis(redisUrlWithIPv6, {
          family: 0, // Dual-stack IPv4/IPv6
          ...commonOptions
        });
      } else {
        logger.warn('💾 ⚠️ No Redis configuration found');
        logger.info('💾 Checking environment variables:');
        logger.info(`   REDISHOST: ${redisHost ? 'Set' : 'Not set'}`);
        logger.info(`   REDISPORT: ${redisPort ? 'Set' : 'Not set'}`);
        logger.info(`   REDISUSER: ${redisUser ? 'Set' : 'Not set'}`);
        logger.info(`   REDISPASSWORD: ${redisPassword ? 'Set' : 'Not set'}`);
        logger.info(`   REDIS_URL: ${redisUrl ? 'Set' : 'Not set'}`);
        logger.info(`   REDIS_PRIVATE_URL: ${process.env.REDIS_PRIVATE_URL ? 'Set' : 'Not set'}`);
        redisClient = null;
      }
      
      // ✅ Set up event handlers
      if (redisClient) {
        redisClient.on('connect', () => {
          logger.info('💾 🔌 Redis connection initiated...');
        });
        
        redisClient.on('ready', () => {
          logger.info('💾 ✅ Redis connected and READY!');
        });
        
        redisClient.on('error', (err) => {
          logger.error('💾 ❌ Redis error:', {
            message: err.message,
            code: err.code,
            errno: err.errno,
            syscall: err.syscall,
            address: err.address,
            port: err.port,
            stack: err.stack
          });
        });
        
        redisClient.on('close', () => {
          logger.warn('💾 ⚠️ Redis connection closed');
        });
        
        redisClient.on('reconnecting', () => {
          logger.info('💾 🔄 Redis reconnecting...');
        });
        
        logger.info(`💾 Redis client initialized, connecting...`);
        logger.info(`💾 Current status: ${redisClient.status}`);
        
        // ✅ Wait briefly for initial connection (non-blocking)
        setTimeout(() => {
          logger.info(`💾 Redis status after 2s: ${redisClient.status}`);
        }, 2000);
      }
    } catch (error) {
      logger.error('💾 ❌ Redis initialization failed:', {
        error: error.message,
        stack: error.stack
      });
      logger.warn('💾 ⚠️ Continuing without Redis (dashboard will not have caching)');
      redisClient = null;
    }
    
    // Initialize Cache Manager (with or without Redis)
    try {
      if (redisClient && redisClient.status === 'ready') {
        // Test Redis connection before creating CacheManager
        try {
          await redisClient.ping();
          cacheManager = new CacheManager(redisClient);
          logger.info('💾 ✅ Cache Manager initialized (with Redis)');
        } catch (pingError) {
          logger.error('💾 ❌ Redis ping failed:', pingError.message);
          logger.warn('💾 ⚠️ Using no-op cache (Redis ping failed)');
          cacheManager = createNoOpCacheManager();
        }
      } else {
        logger.warn(`💾 ⚠️ Redis not ready (status: ${redisClient?.status || 'null'}), using no-op cache`);
        logger.info(`💾 Redis URL configured: ${process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL ? 'Yes' : 'No'}`);
        // Create a no-op cache manager for graceful degradation
        cacheManager = createNoOpCacheManager();
        
        // ✅ CRITICAL: Set up Redis reconnection handler to upgrade cache manager
        if (redisClient) {
          // Remove any existing 'ready' handler to avoid duplicates
          redisClient.removeAllListeners('ready');
          
          // Set up upgrade handler
          redisClient.on('ready', async () => {
            logger.info('💾 🔄 Redis ready event - upgrading cache manager...');
            try {
              await redisClient.ping();
              const newCacheManager = new CacheManager(redisClient);
              
              // ✅ CRITICAL: Update both references
              app.locals.cacheManager = newCacheManager;
              cacheManager = newCacheManager;
              
              logger.info('💾 ✅ Cache Manager upgraded to Redis mode!', {
                hasRedis: !!newCacheManager.redis,
                redisStatus: newCacheManager.redis?.status || 'null'
              });
            } catch (upgradeError) {
              logger.error('💾 ❌ Failed to upgrade cache manager:', {
                error: upgradeError.message,
                stack: upgradeError.stack
              });
            }
          });
          
          // If Redis is already ready, upgrade immediately
          if (redisClient.status === 'ready') {
            logger.info('💾 Redis already ready - upgrading cache manager immediately...');
            try {
              await redisClient.ping();
              const newCacheManager = new CacheManager(redisClient);
              app.locals.cacheManager = newCacheManager;
              cacheManager = newCacheManager;
              logger.info('💾 ✅ Cache Manager upgraded to Redis mode (immediate)!');
            } catch (upgradeError) {
              logger.error('💾 ❌ Failed to upgrade cache manager (immediate):', upgradeError.message);
            }
          }
        }
      }
    } catch (error) {
      logger.error('💾 ❌ Cache Manager failed:', error.message, error.stack);
      // Create no-op fallback
      cacheManager = createNoOpCacheManager();
    }
    
    // Helper function to create no-op cache manager
    function createNoOpCacheManager() {
      return {
        get: async () => null,
        set: async () => true,
        delete: async () => true,
        redis: null
      };
    }
    
    // ✅ Store cacheManager and redisClient in app.locals for route access
    app.locals.cacheManager = cacheManager;
    app.locals.redisClient = redisClient; // For geolocation caching in events.js
    logger.info('💾 ✅ Cache Manager and Redis Client set in app.locals for routes');
    
    // ✅ NEW: Periodic Redis health check (upgrade cache manager if Redis connects later)
    if (redisClient && !cacheManager.redis) {
      let checkCount = 0;
      const maxChecks = 60; // Check for up to 30 minutes (60 * 30s)
      
      const healthCheckInterval = setInterval(async () => {
        checkCount++;
        try {
          const status = redisClient.status;
          logger.info(`💾 Redis health check #${checkCount}: status=${status}`);
          
          if (status === 'ready') {
            const pingResult = await redisClient.ping();
            if (pingResult === 'PONG') {
              logger.info('💾 🔄 Redis health check: Connected! Upgrading cache manager...');
              const newCacheManager = new CacheManager(redisClient);
              app.locals.cacheManager = newCacheManager;
              cacheManager = newCacheManager;
              logger.info('💾 ✅ Cache Manager upgraded to Redis mode via health check!');
              clearInterval(healthCheckInterval); // Stop checking once upgraded
            }
          } else {
            logger.debug(`💾 Redis health check #${checkCount}: Still not ready (status: ${status})`);
          }
          
          // Stop after max checks
          if (checkCount >= maxChecks) {
            clearInterval(healthCheckInterval);
            logger.warn(`💾 Redis health check stopped after ${maxChecks} checks (Redis never connected)`);
          }
        } catch (error) {
          logger.debug(`💾 Redis health check #${checkCount} error:`, error.message);
        }
      }, 30000); // Check every 30 seconds
      
      logger.info('💾 ✅ Redis health check started (will check every 30s for up to 30 minutes)');
    }
    
    // Initialize Firebase Admin SDK for Push Notifications
    try {
      const firebaseMessagingService = require('./services/firebase-messaging-service');
      await firebaseMessagingService.initialize();
      logger.info('🔥 ✅ Firebase Admin SDK initialized');
    } catch (error) {
      logger.warn('🔥 ⚠️ Firebase Admin SDK initialization failed:', error.message);
      logger.warn('🔥 ⚠️ Push notifications will not be available');
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
    
    // Initialize Notification Scheduler (Push Notifications)
    let notificationScheduler = null;
    try {
      const FCMTokenManager = require('./services/fcm-token-manager');
      const NotificationTracker = require('./services/notification-tracker');
      const firebaseMessagingService = require('./services/firebase-messaging-service');
      
      const fcmTokenManager = new FCMTokenManager(db);
      const notificationTracker = new NotificationTracker(db);
      
      notificationScheduler = new NotificationScheduler({
        db,
        firebaseMessagingService,
        fcmTokenManager,
        notificationTracker,
      });
      
      notificationScheduler.start();
      app.locals.notificationScheduler = notificationScheduler;
      logger.info('🔔 ✅ Notification Scheduler started');
    } catch (error) {
      logger.error('🔔 ❌ Notification Scheduler failed:', error.message);
      logger.warn('🔔 ⚠️ Automated push notifications will not be sent');
    }
    
    logger.info('🔧 ✅ Service initialization completed');
    
    // ✅ START SERVER AFTER ALL SERVICES ARE INITIALIZED
    // This ensures dashboard routes and all async initializations are complete
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚂 ✅ FlappyJet Pro Backend running on port ${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
      logger.info(`📊 Dashboard API: http://localhost:${PORT}/api/dashboard/overview`);
      logger.info(`🎮 Event API: http://localhost:${PORT}/api/events`);
      logger.info(`🚀 Railway deployment ready!`);
      logger.info('');
      logger.info('🔧 Services Status:');
      logger.info(`   💾 Redis: ${redisClient && redisClient.status === 'ready' ? '✅ Connected' : '❌ Disconnected'}`);
      logger.info(`   💾 Cache: ${cacheManager && cacheManager.redis ? '✅ Active' : '⚠️ No-op mode'}`);
      logger.info(`   🏆 Tournaments: ${tournamentManager ? '✅ Active' : '❌ Inactive'}`);
      logger.info(`   📅 Scheduler: ${tournamentScheduler ? '✅ Active' : '❌ Inactive'}`);
      logger.info(`   🏅 Leaderboard: ${leaderboardAggregator ? '✅ Active' : '❌ Inactive'}`);
      logger.info(`   🔔 Push Notifications: ${notificationScheduler ? '✅ Active' : '❌ Inactive'}`);
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
    
  } else {
    logger.info('🚂 ⚠️ Database not available, running in minimal mode');
    
    // Start server even without database (for health checks)
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚂 ⚠️ FlappyJet Pro Backend running in MINIMAL MODE on port ${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
    });
  }
})().catch(err => {
  logger.error('🚨 ❌ CRITICAL: Service initialization failed:', err);
  // Don't crash the server, but log the error and start anyway
  server.listen(PORT, '0.0.0.0', () => {
    logger.error(`🚂 ⚠️ Server started with initialization errors on port ${PORT}`);
  });
});

// Trust Railway's proxy for correct client IP extraction
// This ensures req.ip returns the real client IP, not the proxy's IP
app.set('trust proxy', true);

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
  // ✅ Analytics Dashboard API (needs cacheManager from app.locals)
  const dashboardApiRoutes = require('./routes/dashboard-api')(db, app.locals.cacheManager || { get: async () => null, set: async () => true, delete: async () => true, redis: null });
  app.use('/api/dashboard', dashboardApiRoutes);
  
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
  
  // ✅ Push notification routes
  app.use('/api/notifications', notificationsRoutes(db));
  
  // ✅ Auth routes (lightweight device-based authentication)
  const authRoutes = require('./routes/auth')(db);
  app.use('/api/auth', authRoutes);

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

// ✅ Server startup is now handled inside the async IIFE above (after all services initialize)
// This ensures all routes are registered before the server starts accepting connections

module.exports = app;
