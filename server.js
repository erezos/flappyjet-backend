/// 🚂 FlappyJet Pro - Railway Backend Server
/// Production-ready Node.js backend for mobile game

const express = require('express');
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

  // Test database connection
  db.connect()
    .then(() => console.log('🐘 PostgreSQL connected successfully'))
    .catch(err => {
      console.error('🐘 ❌ Database connection error:', err);
      console.log('🚂 ⚠️ Continuing without database for health check...');
    });
} catch (error) {
  console.error('🐘 ❌ Database initialization error:', error);
  console.log('🚂 ⚠️ Continuing without database for health check...');
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
    // Initialize monitoring service
    monitoringService = new MonitoringService(db);
    console.log('📊 ✅ Monitoring Service initialized');
    
    // Initialize enhanced leaderboard service for WebSocket integration
    enhancedLeaderboardService = new EnhancedLeaderboardService(db);
    
    // Initialize WebSocket Manager
    wsManager = new WebSocketManager(server, enhancedLeaderboardService);
    console.log('🌐 ✅ WebSocket Manager initialized');
    
    // Initialize Cache Manager
    cacheManager = new SimpleCacheManager();
    console.log('💾 ✅ Cache Manager initialized');
    
    // Initialize Prize Manager
    prizeManager = new PrizeManager({ db, wsManager });
    console.log('🏆 ✅ Prize Manager initialized');
    
    // Initialize Tournament Manager
    tournamentManager = new TournamentManager({ 
      db, 
      cacheManager, 
      prizeManager, 
      wsManager 
    });
    console.log('🏆 ✅ Tournament Manager initialized');
    
    // Initialize Tournament Scheduler
    tournamentScheduler = new TournamentScheduler({ 
      db, 
      tournamentManager, 
      wsManager 
    });
    tournamentScheduler.start();
    console.log('🏆 ✅ Tournament Scheduler started');
    
  } catch (error) {
    console.warn('🚂 ⚠️ Service initialization failed:', error.message);
  }
} else {
  console.log('🚂 ⚠️ Database not available, running in minimal mode');
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
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
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
  console.log('🚂 ✅ All API routes initialized');
} else {
  // Minimal routes for health check
  app.get('/api/*', (req, res) => {
    res.status(503).json({ 
      error: 'Service temporarily unavailable - database not connected',
      path: req.originalUrl 
    });
  });
  console.log('🚂 ⚠️ API routes disabled - database not available');
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
  console.error('🚨 Server Error:', err);
  
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
  console.log('🎯 Running daily missions reset...');
  try {
    await db.query(`
      UPDATE player_missions 
      SET completed = false, progress = 0, completed_at = NULL
      WHERE mission_type IN ('daily_play', 'daily_score', 'daily_streak')
      AND DATE(created_at) < CURRENT_DATE
    `);
    console.log('🎯 ✅ Daily missions reset completed');
  } catch (error) {
    console.error('🎯 ❌ Daily missions reset failed:', error);
  }
});

// Cleanup old analytics data (keep 90 days)
cron.schedule('0 2 * * 0', async () => {
  console.log('🧹 Running weekly cleanup...');
  try {
    await db.query(`
      DELETE FROM analytics_events 
      WHERE created_at < NOW() - INTERVAL '90 days'
    `);
    console.log('🧹 ✅ Weekly cleanup completed');
  } catch (error) {
    console.error('🧹 ❌ Weekly cleanup failed:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🚂 Received SIGTERM, shutting down gracefully...');
  
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
    console.log('🚂 ✅ Server shutdown complete');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🚂 Received SIGINT, shutting down gracefully...');
  
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
    console.log('🚂 ✅ Server shutdown complete');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 ✅ FlappyJet Pro Backend running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 WebSocket endpoint: ws://localhost:${PORT}/ws/leaderboard`);
  console.log(`🚀 Railway deployment ready!`);
});

module.exports = app;
