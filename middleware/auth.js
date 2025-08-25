/**
 * Authentication Middleware
 * Handles JWT token validation for protected routes
 */

const jwt = require('jsonwebtoken');

/**
 * Middleware to authenticate JWT tokens
 * For now, this is a placeholder that allows all requests through
 * TODO: Implement proper JWT authentication when user system is ready
 */
const authenticateToken = (req, res, next) => {
  // For development/testing, we'll skip authentication
  // and use a default player ID
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    // For now, assign a default player ID for testing
    req.user = {
      id: 'default-player-id',
      playerId: 'default-player-id',
      username: 'TestPlayer'
    };
    return next();
  }
  
  // TODO: Implement proper JWT verification
  // jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
  //   if (err) return res.sendStatus(403);
  //   req.user = user;
  //   next();
  // });
  
  // For now, just pass through with default user
  req.user = {
    id: 'default-player-id',
    playerId: 'default-player-id',
    username: 'TestPlayer'
  };
  next();
};

/**
 * Middleware to check if user is admin
 * TODO: Implement proper admin role checking
 */
const requireAdmin = (req, res, next) => {
  // For now, allow all requests through
  // TODO: Check user role from database
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin
};
