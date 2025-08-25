/**
 * 🚀 Production Deployment Configuration
 * Optimized settings for Railway deployment
 */

module.exports = {
  // Database Configuration
  database: {
    // Connection pool settings for high performance
    pool: {
      max: 20,                    // Maximum connections
      min: 5,                     // Minimum connections
      idle: 10000,                // Idle timeout (10 seconds)
      acquire: 30000,             // Acquire timeout (30 seconds)
      evict: 1000,                // Eviction check interval (1 second)
    },
    
    // Query optimization
    query: {
      timeout: 30000,             // Query timeout (30 seconds)
      logging: process.env.NODE_ENV === 'development',
      benchmark: true,            // Log query execution time
    },
    
    // SSL configuration for production
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false,
      ca: process.env.DB_SSL_CA,
      key: process.env.DB_SSL_KEY,
      cert: process.env.DB_SSL_CERT,
    } : false,
  },

  // Redis Configuration
  redis: {
    // Connection settings
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      
      // Connection pool
      family: 4,                  // IPv4
      keepAlive: true,
      lazyConnect: true,
      
      // Retry configuration
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      retryDelayOnClusterDown: 300,
      
      // Timeouts
      connectTimeout: 10000,      // 10 seconds
      commandTimeout: 5000,       // 5 seconds
    },
    
    // Cache TTL settings (in seconds)
    ttl: {
      leaderboard: 300,           // 5 minutes
      playerStats: 600,           // 10 minutes
      globalStats: 900,           // 15 minutes
      antiCheatData: 3600,        // 1 hour
    },
  },

  // Server Configuration
  server: {
    // Express settings
    port: process.env.PORT || 3000,
    host: '0.0.0.0',
    
    // Request limits
    bodyLimit: '10mb',
    parameterLimit: 1000,
    
    // Compression
    compression: {
      level: 6,                   // Compression level (1-9)
      threshold: 1024,            // Minimum size to compress (bytes)
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return true;
      },
    },
    
    // CORS settings
    cors: {
      origin: process.env.CORS_ORIGIN ? 
        process.env.CORS_ORIGIN.split(',') : 
        ['http://localhost:3000', 'https://flappyjet.app'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
      maxAge: 86400,              // 24 hours
    },
  },

  // Rate Limiting Configuration
  rateLimiting: {
    // General API rate limiting
    general: {
      windowMs: 15 * 60 * 1000,   // 15 minutes
      max: 1000,                  // Requests per window
      message: 'Too many requests from this IP',
      standardHeaders: true,
      legacyHeaders: false,
    },
    
    // Score submission rate limiting
    scoreSubmission: {
      windowMs: 60 * 1000,        // 1 minute
      max: 10,                    // Submissions per minute
      message: 'Too many score submissions',
      skipSuccessfulRequests: false,
    },
    
    // Authentication rate limiting
    auth: {
      windowMs: 15 * 60 * 1000,   // 15 minutes
      max: 5,                     // Login attempts per window
      message: 'Too many authentication attempts',
      skipSuccessfulRequests: true,
    },
  },

  // WebSocket Configuration
  websocket: {
    // Connection settings
    maxConnections: 1000,         // Maximum concurrent connections
    pingInterval: 30000,          // Ping interval (30 seconds)
    pongTimeout: 5000,            // Pong timeout (5 seconds)
    
    // Message limits
    maxMessageSize: 1024 * 16,    // 16KB per message
    maxMessagesPerSecond: 10,     // Messages per second per connection
    
    // Room limits
    maxRoomsPerConnection: 5,     // Maximum rooms per connection
    maxClientsPerRoom: 100,       // Maximum clients per room
  },

  // Monitoring Configuration
  monitoring: {
    // Metrics collection intervals
    intervals: {
      system: 30000,              // System metrics (30 seconds)
      database: 60000,            // Database metrics (1 minute)
      cache: 30000,               // Cache metrics (30 seconds)
      cleanup: 300000,            // Cleanup interval (5 minutes)
    },
    
    // Alert thresholds
    thresholds: {
      cpu: 80,                    // CPU usage percentage
      memory: 85,                 // Memory usage percentage
      responseTime: 1000,         // Response time (ms)
      errorRate: 5,               // Error rate percentage
      cacheHitRate: 70,           // Minimum cache hit rate
    },
    
    // Data retention
    retention: {
      metrics: 7 * 24 * 60 * 60,  // 7 days (seconds)
      logs: 30 * 24 * 60 * 60,    // 30 days (seconds)
      alerts: 90 * 24 * 60 * 60,  // 90 days (seconds)
    },
  },

  // Security Configuration
  security: {
    // JWT settings
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: '7d',            // Token expiration
      issuer: 'flappyjet-api',
      audience: 'flappyjet-app',
    },
    
    // Password hashing
    bcrypt: {
      rounds: 12,                 // Salt rounds
    },
    
    // Helmet security headers
    helmet: {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 31536000,         // 1 year
        includeSubDomains: true,
        preload: true,
      },
    },
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.NODE_ENV === 'production' ? 'json' : 'dev',
    
    // Log rotation
    rotation: {
      maxSize: '20m',             // Maximum log file size
      maxFiles: '14d',            // Keep logs for 14 days
      datePattern: 'YYYY-MM-DD',
    },
    
    // Log categories
    categories: {
      http: true,                 // HTTP requests
      database: false,            // Database queries (disable in production)
      websocket: true,            // WebSocket events
      errors: true,               // Error logging
      performance: true,          // Performance metrics
    },
  },

  // Caching Strategy
  caching: {
    // Application-level caching
    application: {
      enabled: true,
      maxSize: 100,               // Maximum cache entries
      ttl: 300000,                // TTL in milliseconds (5 minutes)
    },
    
    // HTTP response caching
    http: {
      enabled: true,
      maxAge: 300,                // Cache-Control max-age (5 minutes)
      staleWhileRevalidate: 60,   // Stale-while-revalidate (1 minute)
    },
    
    // Static asset caching
    static: {
      maxAge: 86400000,           // 1 day for static assets
      immutable: true,
    },
  },

  // Performance Optimization
  performance: {
    // Database query optimization
    database: {
      enableQueryCache: true,
      queryTimeout: 30000,
      maxQueryComplexity: 1000,
    },
    
    // Memory management
    memory: {
      maxHeapSize: '512m',        // Maximum heap size
      gcInterval: 60000,          // Garbage collection interval
    },
    
    // Connection optimization
    keepAlive: {
      enabled: true,
      initialDelay: 0,
      interval: 1000,
    },
  },

  // Health Check Configuration
  healthCheck: {
    // Check intervals
    intervals: {
      database: 30000,            // Database health check (30 seconds)
      redis: 30000,               // Redis health check (30 seconds)
      external: 60000,            // External services (1 minute)
    },
    
    // Timeout settings
    timeouts: {
      database: 5000,             // Database timeout (5 seconds)
      redis: 3000,                // Redis timeout (3 seconds)
      external: 10000,            // External services timeout (10 seconds)
    },
  },

  // Environment-specific overrides
  environments: {
    development: {
      logging: { level: 'debug' },
      rateLimiting: { general: { max: 10000 } },
      monitoring: { intervals: { system: 10000 } },
    },
    
    staging: {
      database: { pool: { max: 10 } },
      websocket: { maxConnections: 100 },
      monitoring: { thresholds: { cpu: 70 } },
    },
    
    production: {
      logging: { level: 'warn' },
      security: { bcrypt: { rounds: 14 } },
      performance: { memory: { maxHeapSize: '1g' } },
    },
  },
};

// Apply environment-specific overrides
const config = module.exports;
const env = process.env.NODE_ENV || 'development';

if (config.environments[env]) {
  const envConfig = config.environments[env];
  
  // Deep merge environment config
  function deepMerge(target, source) {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        target[key] = target[key] || {};
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  
  deepMerge(config, envConfig);
}
