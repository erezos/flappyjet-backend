// Intermediate server - adding basic dependencies
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

console.log('🚂 Starting intermediate server with basic dependencies...');
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware (same as full server)
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

console.log('✅ Basic middleware loaded');

// Rate limiting (potential issue?)
try {
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
  console.log('✅ Rate limiting loaded');
} catch (error) {
  console.error('❌ Rate limiting failed:', error.message);
}

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🏥 Health check requested');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0-intermediate',
    environment: process.env.NODE_ENV || 'development',
    features: ['basic-middleware', 'rate-limiting']
  });
});

// Root endpoint
app.get('/', (req, res) => {
  console.log('🏠 Root endpoint requested');
  res.json({
    message: '🚂 FlappyJet Pro Backend API (Intermediate Mode)',
    version: '1.0.0-intermediate',
    status: 'running',
    features: ['basic-middleware', 'rate-limiting']
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 ✅ Intermediate server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🚀 Railway deployment ready!`);
});

module.exports = app;
