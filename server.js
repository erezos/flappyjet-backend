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
require('dotenv').config();

// Import route modules
const authRoutes = require('./routes/auth');
const playerRoutes = require('./routes/player');
const leaderboardRoutes = require('./routes/leaderboard');
const missionsRoutes = require('./routes/missions');
const achievementsRoutes = require('./routes/achievements');
const purchaseRoutes = require('./routes/purchase');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
db.connect()
  .then(() => console.log('🐘 PostgreSQL connected successfully'))
  .catch(err => console.error('🐘 ❌ Database connection error:', err));

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

// API Routes
app.use('/api/auth', authRoutes(db));
app.use('/api/player', playerRoutes(db));
app.use('/api/leaderboard', leaderboardRoutes(db));
app.use('/api/missions', missionsRoutes(db));
app.use('/api/achievements', achievementsRoutes(db));
app.use('/api/purchase', purchaseRoutes(db));
app.use('/api/analytics', analyticsRoutes(db));
app.use('/api/admin', adminRoutes(db));

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
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🚂 Received SIGINT, shutting down gracefully...');
  await db.end();
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 FlappyJet Backend running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
