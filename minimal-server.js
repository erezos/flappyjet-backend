// Minimal server for Railway health check debugging
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚂 Starting minimal server...');
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port:', PORT);

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🏥 Health check requested');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0-minimal',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  console.log('🏠 Root endpoint requested');
  res.json({
    message: '🚂 FlappyJet Pro Backend API (Minimal Mode)',
    version: '1.0.0-minimal',
    status: 'running'
  });
});

// Catch all
app.use('*', (req, res) => {
  console.log('❓ Unknown endpoint:', req.originalUrl);
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('🚨 Server Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚂 ✅ Minimal server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🚀 Railway deployment ready!`);
});

module.exports = app;
