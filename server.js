/// 🚂 FlappyJet Pro - Railway Backend Server
/// Production-ready Node.js backend for mobile game

const express = require('express');
const logger = require('./utils/logger');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const http = require('http');
const { WebSocketManager } = require('./services/websocket-manager');
const { EnhancedLeaderboardService } = require('./services/enhanced-leaderboard-service');
const { MonitoringService } = require('./services/monitoring-service');
const TournamentManager = require('./services/tournament-manager');
const PrizeManager = require('./services/prize-manager');
const TournamentScheduler = require('./services/tournament-scheduler');
const SimpleCacheManager = require('./services/simple-cache-manager');
const SmartNotificationScheduler = require('./services/smart-notification-scheduler');
require('dotenv').config();

// Import route modules
const authRoutes = require('./routes/auth');
const playerRoutes = require('./routes/player');
const leaderboardRoutes = require('./routes/leaderboard');
const enhancedLeaderboardRoutes = require('./routes/enhanced-leaderboard');
const tournamentRoutes = require('./routes/tournaments');
const missionsRoutes = require('./routes/missions');
const achievementsRoutes = require('./routes/achievements');
const purchaseRoutes = require('./routes/purchase');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const fcmRoutes = require('./routes/fcm');
const analyticsDashboardRoutes = require('./routes/analytics-dashboard');

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
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  // Test database connection and auto-migrate
  db.connect()
    .then(async () => {
      logger.info('🐘 PostgreSQL connected successfully', { 
        host: db.options.host, 
        database: db.options.database 
      });
      
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
    })
    .catch(err => {
      logger.error('🐘 ❌ Database connection error:', err);
      logger.info('🚂 ⚠️ Continuing without database for health check...');
    });
} catch (error) {
  logger.error('🐘 ❌ Database initialization error:', error);
  logger.info('🚂 ⚠️ Continuing without database for health check...');
}

// Initialize services
let wsManager = null;
let enhancedLeaderboardService = null;
let monitoringService = null;
let tournamentManager = null;
let prizeManager = null;
let tournamentScheduler = null;
let cacheManager = null;

// Initialize services only if database is available
if (db) {
  try {
    logger.info('🔧 Starting service initialization...');
    
    // Initialize monitoring service
    try {
      monitoringService = new MonitoringService(db);
      logger.info('📊 ✅ Monitoring Service initialized');
    } catch (error) {
      logger.error('📊 ❌ Monitoring Service failed:', error.message);
    }
    
    // Initialize enhanced leaderboard service for WebSocket integration
    try {
      enhancedLeaderboardService = new EnhancedLeaderboardService(db);
      logger.info('🏆 ✅ Enhanced Leaderboard Service initialized');
    } catch (error) {
      logger.error('🏆 ❌ Enhanced Leaderboard Service failed:', error.message);
    }
    
    // Initialize WebSocket Manager
    try {
      wsManager = new WebSocketManager(server, enhancedLeaderboardService);
      logger.info('🌐 ✅ WebSocket Manager initialized');
    } catch (error) {
      logger.error('🌐 ❌ WebSocket Manager failed:', error.message);
    }
    
    // Initialize Cache Manager
    try {
      cacheManager = new SimpleCacheManager();
      logger.info('💾 ✅ Cache Manager initialized');
    } catch (error) {
      logger.error('💾 ❌ Cache Manager failed:', error.message);
    }
    
    // Initialize Prize Manager
    try {
      prizeManager = new PrizeManager({ db, wsManager });
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
        wsManager 
      });
      logger.info('🏆 ✅ Tournament Manager initialized');
    } catch (error) {
      logger.error('🏆 ❌ Tournament Manager failed:', error.message);
    }
    
    // Initialize Tournament Scheduler
    try {
      tournamentScheduler = new TournamentScheduler({ 
        db, 
        tournamentManager, 
        wsManager 
      });
      tournamentScheduler.start();
      logger.info('🏆 ✅ Tournament Scheduler started');

      // Initialize Smart Notification Scheduler for FCM
      const notificationScheduler = new SmartNotificationScheduler(db);
      notificationScheduler.start();
      logger.info('🔥 ✅ Smart Notification Scheduler started');
    } catch (error) {
      logger.error('🏆 ❌ Tournament Scheduler failed:', error.message);
    }
    
    logger.info('🔧 ✅ Service initialization completed');
    
  } catch (error) {
    logger.error('🚂 ❌ Service initialization failed:', error);
    logger.info('🚂 ⚠️ Continuing with available services...');
  }
} else {
  logger.info('🚂 ⚠️ Database not available, running in minimal mode');
}

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

// Health check endpoint
app.get('/health', (req, res) => {
  logger.info('🏥 Health check requested');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      database: !!db,
      monitoring: !!monitoringService,
      websocket: !!wsManager,
      cache: !!cacheManager,
      tournament: !!tournamentManager,
      scheduler: !!tournamentScheduler
    }
  });
});

// Migration endpoint removed for security

// Make services available to routes
app.locals.wsManager = wsManager;
app.locals.monitoringService = monitoringService;
app.locals.tournamentManager = tournamentManager;
app.locals.prizeManager = prizeManager;
app.locals.tournamentScheduler = tournamentScheduler;

// API Routes (only if database is available)
if (db) {
  app.use('/api/auth', authRoutes(db));
  app.use('/api/player', playerRoutes(db));
  app.use('/api/leaderboard', leaderboardRoutes(db));
  app.use('/api/leaderboard/enhanced', enhancedLeaderboardRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api/missions', missionsRoutes(db));
  app.use('/api/achievements', achievementsRoutes(db));
  app.use('/api/purchase', purchaseRoutes(db));
app.use('/api/analytics', analyticsRoutes(db));
app.use('/api/admin', adminRoutes(db));
app.use('/api/fcm', fcmRoutes(db));

// Analytics Dashboard Routes
app.use('/api/analytics', analyticsDashboardRoutes);

// Serve static dashboard files
app.use('/analytics', express.static('analytics'));
  logger.info('🚂 ✅ All API routes initialized');
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
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      player: '/api/player/*',
      leaderboard: '/api/leaderboard/*',
      tournaments: '/api/tournaments/*',
      missions: '/api/missions/*',
      achievements: '/api/achievements/*',
      purchase: '/api/purchase/*',
      analytics: '/api/analytics/*',
      admin: '/api/admin/*'
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
  
  // Shutdown WebSocket Manager
  if (wsManager) {
    wsManager.shutdown();
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
  
  // Shutdown WebSocket Manager
  if (wsManager) {
    wsManager.shutdown();
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

// Start server with error handling
try {
  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚂 ✅ FlappyJet Pro Backend running on port ${PORT}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`📊 Health check: http://localhost:${PORT}/health`);
    logger.info(`🌐 WebSocket endpoint: ws://localhost:${PORT}/ws/leaderboard`);
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
