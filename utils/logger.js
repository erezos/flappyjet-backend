/// 🚂 PRODUCTION LOGGER - Industry-standard logging for Railway backend
/// Zero console.log in production - proper structured logging with Winston

const winston = require('winston');
const path = require('path');

// Production logging configuration
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Development logging configuration (readable)
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${service || 'BACKEND'}] ${level}: ${message} ${metaStr}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: process.env.NODE_ENV === 'production' ? logFormat : devFormat,
  defaultMeta: { 
    service: 'flappyjet-backend',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console transport (always enabled for Railway logs)
    new winston.transports.Console({
      stderrLevels: ['error', 'warn'],
    }),
  ],
});

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
  // Error log file
  logger.add(new winston.transports.File({
    filename: path.join(__dirname, '../logs/error.log'),
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }));

  // Combined log file
  logger.add(new winston.transports.File({
    filename: path.join(__dirname, '../logs/combined.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }));
}

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Production-safe logging methods
const productionLogger = {
  // Debug - only in development
  debug: (message, meta = {}) => {
    logger.debug(message, meta);
  },

  // Info - general information
  info: (message, meta = {}) => {
    logger.info(message, meta);
  },

  // Warn - warnings that need attention
  warn: (message, meta = {}) => {
    logger.warn(message, meta);
  },

  // Error - errors that need immediate attention
  error: (message, error = null, meta = {}) => {
    if (error) {
      logger.error(message, { 
        error: error.message, 
        stack: error.stack,
        ...meta 
      });
    } else {
      logger.error(message, meta);
    }
  },

  // Critical - system-critical errors
  critical: (message, error = null, meta = {}) => {
    const criticalMeta = {
      severity: 'CRITICAL',
      timestamp: new Date().toISOString(),
      ...meta
    };
    
    if (error) {
      logger.error(`🚨 CRITICAL: ${message}`, { 
        error: error.message, 
        stack: error.stack,
        ...criticalMeta 
      });
    } else {
      logger.error(`🚨 CRITICAL: ${message}`, criticalMeta);
    }
  },

  // HTTP request logging
  http: (req, res, responseTime) => {
    const meta = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
    };

    if (res.statusCode >= 400) {
      logger.warn(`HTTP ${res.statusCode} ${req.method} ${req.url}`, meta);
    } else {
      logger.info(`HTTP ${res.statusCode} ${req.method} ${req.url}`, meta);
    }
  },

  // Database operation logging
  db: (operation, table, meta = {}) => {
    logger.info(`DB ${operation.toUpperCase()} ${table}`, {
      operation,
      table,
      ...meta
    });
  },

  // Tournament system logging
  tournament: (action, tournamentId, meta = {}) => {
    logger.info(`🏆 TOURNAMENT ${action.toUpperCase()}`, {
      action,
      tournamentId,
      ...meta
    });
  },

  // WebSocket logging
  websocket: (event, clientId, meta = {}) => {
    logger.info(`🌐 WS ${event.toUpperCase()}`, {
      event,
      clientId,
      ...meta
    });
  },

  // Performance monitoring
  performance: (metric, value, meta = {}) => {
    logger.info(`📊 PERFORMANCE ${metric}`, {
      metric,
      value,
      unit: meta.unit || 'ms',
      ...meta
    });
  }
};

// Export logger
module.exports = productionLogger;

// Log initialization
productionLogger.info('🚂 Production Logger initialized', {
  level: logger.level,
  environment: process.env.NODE_ENV || 'development',
  transports: logger.transports.length
});
