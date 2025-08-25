// Database server - testing database connection
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { Pool } = require('pg');
require('dotenv').config();

console.log('🚂 Starting database server...');
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('🔗 Database URL exists:', !!process.env.DATABASE_URL);

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection (same as full server)
let db = null;
let dbStatus = 'not_initialized';

try {
  console.log('🐘 Initializing database connection...');
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  dbStatus = 'initialized';
  console.log('🐘 ✅ Database pool created');

  // Test database connection
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

console.log('✅ All middleware loaded');

// Health check endpoint with database status
app.get('/health', (req, res) => {
  console.log('🏥 Health check requested - DB Status:', dbStatus);
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0-database',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus,
      hasUrl: !!process.env.DATABASE_URL,
      poolInitialized: !!db
    },
    features: ['basic-middleware', 'rate-limiting', 'database-connection']
  });
});

// Database test endpoint
app.get('/db-test', async (req, res) => {
  console.log('🔍 Database test requested');
  
  if (!db) {
    return res.status(503).json({
      error: 'Database not initialized',
      status: dbStatus
    });
  }

  try {
    const result = await db.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('🐘 ✅ Database query successful');
    res.json({
      success: true,
      data: result.rows[0],
      status: dbStatus
    });
  } catch (error) {
    console.error('🐘 ❌ Database query failed:', error.message);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message,
      status: dbStatus
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  console.log('🏠 Root endpoint requested');
  res.json({
    message: '🚂 FlappyJet Pro Backend API (Database Mode)',
    version: '1.0.0-database',
    status: 'running',
    database: {
      status: dbStatus,
      hasUrl: !!process.env.DATABASE_URL
    },
    features: ['basic-middleware', 'rate-limiting', 'database-connection']
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
  if (db) {
    await db.end();
  }
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 ✅ Database server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 Database test: http://localhost:${PORT}/db-test`);
  console.log(`🚀 Railway deployment ready!`);
});

module.exports = app;
