/**
 * Authentication Middleware
 * Handles JWT token validation for protected routes
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * JWT Secret - In production, this should be in environment variables
 */
const JWT_SECRET = process.env.JWT_SECRET || 'flappyjet-dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Middleware to authenticate JWT tokens
 * Validates JWT tokens and sets req.user with player information
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required',
      code: 'AUTH_TOKEN_MISSING'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log('🔐 JWT Verification Error:', err.name, err.message);
      console.log('🔐 Token (first 50 chars):', token.substring(0, 50));
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'AUTH_TOKEN_INVALID',
        debug: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }

    // Set user information from JWT payload
    req.user = {
      id: decoded.playerId,
      playerId: decoded.playerId,
      username: decoded.username || 'Anonymous',
      deviceId: decoded.deviceId,
      iat: decoded.iat,
      exp: decoded.exp
    };

    // Debug logging
    console.log('🔐 Auth middleware debug:', {
      decodedPlayerId: decoded.playerId,
      reqUserPlayerId: req.user.playerId,
      tokenValid: true
    });

    next();
  });
};

/**
 * Optional authentication - doesn't fail if no token provided
 * Useful for endpoints that work with or without authentication
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // No token provided, continue without user
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      // Invalid token, but don't fail - continue without user
      req.user = null;
      return next();
    }

    req.user = {
      id: decoded.playerId,
      playerId: decoded.playerId,
      username: decoded.username || 'Anonymous',
      deviceId: decoded.deviceId,
      iat: decoded.iat,
      exp: decoded.exp
    };
    next();
  });
};

/**
 * Middleware to check if user is admin
 * Checks for admin role in user data
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  // TODO: Implement proper admin role checking from database
  // For now, check if user has admin flag or is in admin list
  const adminPlayerIds = process.env.ADMIN_PLAYER_IDS ?
    process.env.ADMIN_PLAYER_IDS.split(',') : [];

  if (!adminPlayerIds.includes(req.user.playerId)) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    });
  }

  next();
};

/**
 * Generate JWT token for a player
 */
const generateToken = (playerData) => {
  const payload = {
    playerId: playerData.playerId,
    username: playerData.username || 'Anonymous',
    deviceId: playerData.deviceId || generateDeviceId(),
    iat: Math.floor(Date.now() / 1000)
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Generate a unique device ID
 */
const generateDeviceId = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Validate token without middleware (utility function)
 */
const validateToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
  generateToken,
  validateToken,
  generateDeviceId
};
