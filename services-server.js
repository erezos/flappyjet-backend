// Services server - testing service initialization
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { Pool } = require('pg');
const http = require('http');
require('dotenv').config();

console.log('🚂 Starting services server...');
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Database connection
let db = null;
let dbStatus = 'not_initialized';

try {
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  dbStatus = 'initialized';
  console.log('🐘 ✅ Database pool created');

  db.connect()
    .then(() => {
      console.log('🐘 ✅ PostgreSQL connected successfully');
      dbStatus = 'connected';
    })
    .catch(err => {
      console.error('🐘 ❌ Database connection error:', err.message);
      dbStatus = 'connection_failed';
    });
} catch (error) {
  console.error('🐘 ❌ Database initialization error:', error.message);
  dbStatus = 'initialization_failed';
}

// Service initialization tracking
const serviceStatus = {
  monitoring: 'not_attempted',
  enhancedLeaderboard: 'not_attempted',
  websocket: 'not_attempted',
  cache: 'not_attempted',
  prize: 'not_attempted',
  tournament: 'not_attempted',
  scheduler: 'not_attempted'
};

let services = {
  wsManager: null,
  enhancedLeaderboardService: null,
  monitoringService: null,
  tournamentManager: null,
  prizeManager: null,
  tournamentScheduler: null,
  cacheManager: null
};

// Initialize services one by one with error handling
if (db && dbStatus !== 'initialization_failed') {
  console.log('🔧 Starting service initialization...');

  // 1. Monitoring Service
  try {
    console.log('📊 Initializing Monitoring Service...');
    const { MonitoringService } = require('./services/monitoring-service');
    services.monitoringService = new MonitoringService(db);
    serviceStatus.monitoring = 'success';
    console.log('📊 ✅ Monitoring Service initialized');
  } catch (error) {
    console.error('📊 ❌ Monitoring Service failed:', error.message);
    serviceStatus.monitoring = `failed: ${error.message}`;
  }

  // 2. Enhanced Leaderboard Service
  try {
    console.log('🏆 Initializing Enhanced Leaderboard Service...');
    const { EnhancedLeaderboardService } = require('./services/enhanced-leaderboard-service');
    services.enhancedLeaderboardService = new EnhancedLeaderboardService(db);
    serviceStatus.enhancedLeaderboard = 'success';
    console.log('🏆 ✅ Enhanced Leaderboard Service initialized');
  } catch (error) {
    console.error('🏆 ❌ Enhanced Leaderboard Service failed:', error.message);
    serviceStatus.enhancedLeaderboard = `failed: ${error.message}`;
  }

  // 3. WebSocket Manager
  try {
    console.log('🌐 Initializing WebSocket Manager...');
    const { WebSocketManager } = require('./services/websocket-manager');
    services.wsManager = new WebSocketManager(server, services.enhancedLeaderboardService);
    serviceStatus.websocket = 'success';
    console.log('🌐 ✅ WebSocket Manager initialized');
  } catch (error) {
    console.error('🌐 ❌ WebSocket Manager failed:', error.message);
    serviceStatus.websocket = `failed: ${error.message}`;
  }

  // 4. Cache Manager
  try {
    console.log('💾 Initializing Cache Manager...');
    const SimpleCacheManager = require('./services/simple-cache-manager');
    services.cacheManager = new SimpleCacheManager();
    serviceStatus.cache = 'success';
    console.log('💾 ✅ Cache Manager initialized');
  } catch (error) {
    console.error('💾 ❌ Cache Manager failed:', error.message);
    serviceStatus.cache = `failed: ${error.message}`;
  }

  // 5. Prize Manager
  try {
    console.log('🏆 Initializing Prize Manager...');
    const PrizeManager = require('./services/prize-manager');
    services.prizeManager = new PrizeManager({ db, wsManager: services.wsManager });
    serviceStatus.prize = 'success';
    console.log('🏆 ✅ Prize Manager initialized');
  } catch (error) {
    console.error('🏆 ❌ Prize Manager failed:', error.message);
    serviceStatus.prize = `failed: ${error.message}`;
  }

  // 6. Tournament Manager
  try {
    console.log('🏆 Initializing Tournament Manager...');
    const TournamentManager = require('./services/tournament-manager');
    services.tournamentManager = new TournamentManager({ 
      db, 
      cacheManager: services.cacheManager, 
      prizeManager: services.prizeManager, 
      wsManager: services.wsManager 
    });
    serviceStatus.tournament = 'success';
    console.log('🏆 ✅ Tournament Manager initialized');
  } catch (error) {
    console.error('🏆 ❌ Tournament Manager failed:', error.message);
    serviceStatus.tournament = `failed: ${error.message}`;
  }

  // 7. Tournament Scheduler
  try {
    console.log('⏰ Initializing Tournament Scheduler...');
    const TournamentScheduler = require('./services/tournament-scheduler');
    services.tournamentScheduler = new TournamentScheduler({ 
      db, 
      tournamentManager: services.tournamentManager, 
      wsManager: services.wsManager 
    });
    services.tournamentScheduler.start();
    serviceStatus.scheduler = 'success';
    console.log('⏰ ✅ Tournament Scheduler started');
  } catch (error) {
    console.error('⏰ ❌ Tournament Scheduler failed:', error.message);
    serviceStatus.scheduler = `failed: ${error.message}`;
  }

  console.log('🔧 ✅ Service initialization completed');
} else {
  console.log('🚂 ⚠️ Database not available, skipping service initialization');
}

// Basic middleware
app.use(helmet({
  contentSecurityPolicy: false,
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
  points: 100,
  duration: 60,
});

const rateLimitMiddleware = (req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).json({ error: 'Too many requests' }));
};

app.use(rateLimitMiddleware);

// Health check endpoint with service status
app.get('/health', (req, res) => {
  console.log('🏥 Health check requested');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0-services',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus,
      hasUrl: !!process.env.DATABASE_URL
    },
    services: serviceStatus,
    features: ['basic-middleware', 'rate-limiting', 'database-connection', 'service-initialization']
  });
});

// Service status endpoint
app.get('/services', (req, res) => {
  console.log('🔧 Service status requested');
  res.json({
    database: {
      status: dbStatus,
      hasUrl: !!process.env.DATABASE_URL
    },
    services: serviceStatus,
    initialized: {
      monitoring: !!services.monitoringService,
      enhancedLeaderboard: !!services.enhancedLeaderboardService,
      websocket: !!services.wsManager,
      cache: !!services.cacheManager,
      prize: !!services.prizeManager,
      tournament: !!services.tournamentManager,
      scheduler: !!services.tournamentScheduler
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '🚂 FlappyJet Pro Backend API (Services Mode)',
    version: '1.0.0-services',
    status: 'running',
    database: { status: dbStatus },
    services: serviceStatus,
    features: ['basic-middleware', 'rate-limiting', 'database-connection', 'service-initialization']
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('🚨 Server Error:', err);
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🚂 Received SIGTERM, shutting down gracefully...');
  
  if (services.tournamentScheduler) {
    services.tournamentScheduler.stop();
  }
  
  if (services.wsManager) {
    services.wsManager.shutdown();
  }
  
  if (db) {
    await db.end();
  }
  
  server.close(() => {
    console.log('🚂 ✅ Server shutdown complete');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 ✅ Services server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Services status: http://localhost:${PORT}/services`);
  console.log(`🚀 Railway deployment ready!`);
});

module.exports = app;
