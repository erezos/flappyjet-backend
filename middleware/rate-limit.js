/**
 * Rate Limiting Middleware
 * Provides rate limiting for API endpoints
 */

const { RateLimiterMemory } = require('rate-limiter-flexible');

// Default rate limiter (100 requests per minute)
const defaultRateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
});

// Strict rate limiter for sensitive operations (10 requests per minute)
const strictRateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 10,
  duration: 60,
});

// Tournament-specific rate limiter (30 requests per minute)
const tournamentRateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 30,
  duration: 60,
});

/**
 * Configurable rate limiting middleware factory
 * @param {string} name - Name identifier for the rate limiter
 * @param {number} duration - Duration in seconds
 * @param {number} points - Number of allowed requests
 */
const rateLimitMiddleware = (name, duration = 60, points = 100) => {
  const limiter = new RateLimiterMemory({
    keyGenerator: (req) => `${name}:${req.ip}`,
    points: points,
    duration: duration,
  });

  return (req, res, next) => {
    limiter.consume(req.ip)
      .then(() => next())
      .catch(() => res.status(429).json({ 
        error: 'Too many requests',
        message: `Rate limit exceeded for ${name}. Please try again later.`
      }));
  };
};

/**
 * Default rate limiting middleware (for backward compatibility)
 */
const defaultRateLimit = (req, res, next) => {
  defaultRateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).json({ 
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.'
    }));
};

/**
 * Strict rate limiting for sensitive operations
 */
const strictRateLimit = (req, res, next) => {
  strictRateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).json({ 
      error: 'Too many requests',
      message: 'Rate limit exceeded for this operation. Please try again later.'
    }));
};

/**
 * Tournament-specific rate limiting
 */
const tournamentRateLimit = (req, res, next) => {
  tournamentRateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).json({ 
      error: 'Too many tournament requests',
      message: 'Tournament rate limit exceeded. Please try again later.'
    }));
};

module.exports = {
  rateLimitMiddleware,
  defaultRateLimit,
  strictRateLimit,
  tournamentRateLimit
};
