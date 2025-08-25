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
 * Default rate limiting middleware
 */
const rateLimitMiddleware = (req, res, next) => {
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
  strictRateLimit,
  tournamentRateLimit
};
