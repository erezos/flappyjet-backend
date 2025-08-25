// Routes server - testing route imports and initialization
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { Pool } = require('pg');
const http = require('http');
require('dotenv').config();

console.log('🚂 Starting routes server...');
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

// Service initialization (same as before)
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

if (db && dbStatus !== 'initialization_failed') {
  console.log('🔧 Starting service initialization...');

  try {
    const { MonitoringService } = require('./services/monitoring-service');
    services.monitoringService = new MonitoringService(db);
    serviceStatus.monitoring = 'success';
    console.log('📊 ✅ Monitoring Service initialized');
  } catch (error) {
    console.error('📊 ❌ Monitoring Service failed:', error.message);
    serviceStatus.monitoring = `failed: ${error.message}`;
  }

  try {
    const { EnhancedLeaderboardService } = require('./services/enhanced-leaderboard-service');
    services.enhancedLeaderboardService = new EnhancedLeaderboardService(db);
    serviceStatus.enhancedLeaderboard = 'success';
    console.log('🏆 ✅ Enhanced Leaderboard Service initialized');
  } catch (error) {
    console.error('🏆 ❌ Enhanced Leaderboard Service failed:', error.message);
    serviceStatus.enhancedLeaderboard = `failed: ${error.message}`;
  }

  try {
    const { WebSocketManager } = require('./services/websocket-manager');
    services.wsManager = new WebSocketManager(server, services.enhancedLeaderboardService);
    serviceStatus.websocket = 'success';
    console.log('🌐 ✅ WebSocket Manager initialized');
  } catch (error) {
    console.error('🌐 ❌ WebSocket Manager failed:', error.message);
    serviceStatus.websocket = `failed: ${error.message}`;
  }

  try {
    const SimpleCacheManager = require('./services/simple-cache-manager');
    services.cacheManager = new SimpleCacheManager();
    serviceStatus.cache = 'success';
    console.log('💾 ✅ Cache Manager initialized');
  } catch (error) {
    console.error('💾 ❌ Cache Manager failed:', error.message);
    serviceStatus.cache = `failed: ${error.message}`;
  }

  try {
    const PrizeManager = require('./services/prize-manager');
    services.prizeManager = new PrizeManager({ db, wsManager: services.wsManager });
    serviceStatus.prize = 'success';
    console.log('🏆 ✅ Prize Manager initialized');
  } catch (error) {
    console.error('🏆 ❌ Prize Manager failed:', error.message);
    serviceStatus.prize = `failed: ${error.message}`;
  }

  try {
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

  try {
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
}

// Route import tracking
const routeStatus = {
  auth: 'not_attempted',
  player: 'not_attempted',
  leaderboard: 'not_attempted',
  enhancedLeaderboard: 'not_attempted',
  tournaments: 'not_attempted',
  missions: 'not_attempted',
  achievements: 'not_attempted',
  purchase: 'not_attempted',
  analytics: 'not_attempted',
  admin: 'not_attempted'
};

let routes = {};

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

// Make services available to routes
app.locals.wsManager = services.wsManager;
app.locals.monitoringService = services.monitoringService;
app.locals.tournamentManager = services.tournamentManager;
app.locals.prizeManager = services.prizeManager;
app.locals.tournamentScheduler = services.tournamentScheduler;

console.log('🛣️ Starting route imports...');

// Import routes one by one with error handling
if (db) {
  // 1. Auth Routes
  try {
    console.log('🔐 Importing auth routes...');
    routes.authRoutes = require('./routes/auth');
    app.use('/api/auth', routes.authRoutes(db));
    routeStatus.auth = 'success';
    console.log('🔐 ✅ Auth routes loaded');
  } catch (error) {
    console.error('🔐 ❌ Auth routes failed:', error.message);
    routeStatus.auth = `failed: ${error.message}`;
  }

  // 2. Player Routes
  try {
    console.log('👤 Importing player routes...');
    routes.playerRoutes = require('./routes/player');
    app.use('/api/player', routes.playerRoutes(db));
    routeStatus.player = 'success';
    console.log('👤 ✅ Player routes loaded');
  } catch (error) {
    console.error('👤 ❌ Player routes failed:', error.message);
    routeStatus.player = `failed: ${error.message}`;
  }

  // 3. Leaderboard Routes
  try {
    console.log('🏆 Importing leaderboard routes...');
    routes.leaderboardRoutes = require('./routes/leaderboard');
    app.use('/api/leaderboard', routes.leaderboardRoutes(db));
    routeStatus.leaderboard = 'success';
    console.log('🏆 ✅ Leaderboard routes loaded');
  } catch (error) {
    console.error('🏆 ❌ Leaderboard routes failed:', error.message);
    routeStatus.leaderboard = `failed: ${error.message}`;
  }

  // 4. Enhanced Leaderboard Routes
  try {
    console.log('🏆 Importing enhanced leaderboard routes...');
    routes.enhancedLeaderboardRoutes = require('./routes/enhanced-leaderboard');
    app.use('/api/leaderboard/enhanced', routes.enhancedLeaderboardRoutes);
    routeStatus.enhancedLeaderboard = 'success';
    console.log('🏆 ✅ Enhanced leaderboard routes loaded');
  } catch (error) {
    console.error('🏆 ❌ Enhanced leaderboard routes failed:', error.message);
    routeStatus.enhancedLeaderboard = `failed: ${error.message}`;
  }

  // 5. Tournament Routes
  try {
    console.log('🏆 Importing tournament routes...');
    routes.tournamentRoutes = require('./routes/tournaments');
    app.use('/api/tournaments', routes.tournamentRoutes);
    routeStatus.tournaments = 'success';
    console.log('🏆 ✅ Tournament routes loaded');
  } catch (error) {
    console.error('🏆 ❌ Tournament routes failed:', error.message);
    routeStatus.tournaments = `failed: ${error.message}`;
  }

  // 6. Missions Routes
  try {
    console.log('🎯 Importing missions routes...');
    routes.missionsRoutes = require('./routes/missions');
    app.use('/api/missions', routes.missionsRoutes(db));
    routeStatus.missions = 'success';
    console.log('🎯 ✅ Missions routes loaded');
  } catch (error) {
    console.error('🎯 ❌ Missions routes failed:', error.message);
    routeStatus.missions = `failed: ${error.message}`;
  }

  // 7. Achievements Routes
  try {
    console.log('🏅 Importing achievements routes...');
    routes.achievementsRoutes = require('./routes/achievements');
    app.use('/api/achievements', routes.achievementsRoutes(db));
    routeStatus.achievements = 'success';
    console.log('🏅 ✅ Achievements routes loaded');
  } catch (error) {
    console.error('🏅 ❌ Achievements routes failed:', error.message);
    routeStatus.achievements = `failed: ${error.message}`;
  }

  // 8. Purchase Routes
  try {
    console.log('💰 Importing purchase routes...');
    routes.purchaseRoutes = require('./routes/purchase');
    app.use('/api/purchase', routes.purchaseRoutes(db));
    routeStatus.purchase = 'success';
    console.log('💰 ✅ Purchase routes loaded');
  } catch (error) {
    console.error('💰 ❌ Purchase routes failed:', error.message);
    routeStatus.purchase = `failed: ${error.message}`;
  }

  // 9. Analytics Routes
  try {
    console.log('📊 Importing analytics routes...');
    routes.analyticsRoutes = require('./routes/analytics');
    app.use('/api/analytics', routes.analyticsRoutes(db));
    routeStatus.analytics = 'success';
    console.log('📊 ✅ Analytics routes loaded');
  } catch (error) {
    console.error('📊 ❌ Analytics routes failed:', error.message);
    routeStatus.analytics = `failed: ${error.message}`;
  }

  // 10. Admin Routes
  try {
    console.log('⚙️ Importing admin routes...');
    routes.adminRoutes = require('./routes/admin');
    app.use('/api/admin', routes.adminRoutes(db));
    routeStatus.admin = 'success';
    console.log('⚙️ ✅ Admin routes loaded');
  } catch (error) {
    console.error('⚙️ ❌ Admin routes failed:', error.message);
    routeStatus.admin = `failed: ${error.message}`;
  }

  console.log('🛣️ ✅ Route imports completed');
} else {
  console.log('🚂 ⚠️ Database not available, skipping route imports');
}

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🏥 Health check requested');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0-routes',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus,
      hasUrl: !!process.env.DATABASE_URL
    },
    services: serviceStatus,
    routes: routeStatus,
    features: ['basic-middleware', 'rate-limiting', 'database-connection', 'service-initialization', 'route-imports']
  });
});

// Routes status endpoint
app.get('/routes', (req, res) => {
  console.log('🛣️ Routes status requested');
  res.json({
    database: { status: dbStatus },
    services: serviceStatus,
    routes: routeStatus,
    summary: {
      servicesInitialized: Object.values(serviceStatus).filter(s => s === 'success').length,
      routesLoaded: Object.values(routeStatus).filter(r => r === 'success').length,
      totalServices: Object.keys(serviceStatus).length,
      totalRoutes: Object.keys(routeStatus).length
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '🚂 FlappyJet Pro Backend API (Routes Mode)',
    version: '1.0.0-routes',
    status: 'running',
    database: { status: dbStatus },
    services: serviceStatus,
    routes: routeStatus,
    features: ['basic-middleware', 'rate-limiting', 'database-connection', 'service-initialization', 'route-imports']
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
  console.log(`🚂 ✅ Routes server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🛣️ Routes status: http://localhost:${PORT}/routes`);
  console.log(`🚀 Railway deployment ready!`);
});

module.exports = app;
