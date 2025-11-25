/**
 * Geolocation Service
 * 
 * Provides IP-based geolocation using MaxMind's GeoLite2 database.
 * Uses geoip-lite package which bundles the database (no API calls needed).
 * 
 * Features:
 * - Fast lookups (~1ms, database is in memory)
 * - No external API calls or rate limits
 * - ~95% accuracy at country level
 * - Automatic database updates via npm update
 */

const geoip = require('geoip-lite');
const logger = require('../utils/logger');

class GeolocationService {
  constructor(redisClient = null, db = null) {
    this.redis = redisClient;
    this.db = db;
    this.cachePrefix = 'geo:user:';
    this.cacheTTL = 7 * 24 * 60 * 60; // 7 days in seconds
  }

  /**
   * Extract client IP from Express request
   * Handles X-Forwarded-For header from Railway's proxy
   * 
   * @param {Object} req - Express request object
   * @returns {string|null} - Client IP address or null
   */
  extractClientIP(req) {
    try {
      // req.ip already handles X-Forwarded-For when 'trust proxy' is set
      let ip = req.ip;

      // Handle IPv6-mapped IPv4 addresses (::ffff:192.168.1.1)
      if (ip && ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
      }

      // Validate IP is not empty and not localhost
      if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
        logger.debug('🌍 Local/invalid IP detected, cannot geolocate');
        return null;
      }

      return ip;
    } catch (error) {
      logger.error('🌍 ❌ Error extracting client IP:', error.message);
      return null;
    }
  }

  /**
   * Get 2-letter ISO country code from IP address
   * Uses MaxMind GeoLite2 database (bundled with geoip-lite)
   * 
   * @param {string} ip - IP address to lookup
   * @returns {string|null} - 2-letter country code (e.g., "IL", "US") or null
   */
  getCountryFromIP(ip) {
    try {
      if (!ip) return null;

      const geo = geoip.lookup(ip);

      if (geo && geo.country) {
        logger.debug(`🌍 GeoIP lookup: ${ip} → ${geo.country}`);
        return geo.country; // 2-letter ISO code (e.g., "IL", "US")
      }

      logger.debug(`🌍 GeoIP lookup failed for IP: ${ip}`);
      return null;
    } catch (error) {
      logger.error('🌍 ❌ GeoIP lookup error:', error.message);
      return null;
    }
  }

  /**
   * Get country from Express request (convenience method)
   * 
   * @param {Object} req - Express request object
   * @returns {string|null} - 2-letter country code or null
   */
  getCountryFromRequest(req) {
    const ip = this.extractClientIP(req);
    return this.getCountryFromIP(ip);
  }

  /**
   * Get country for a user, using cache when available
   * 
   * Flow:
   * 1. Check Redis cache
   * 2. If not found, do GeoIP lookup
   * 3. Cache result in Redis + update PostgreSQL
   * 
   * @param {string} userId - User ID
   * @param {Object} req - Express request object
   * @returns {Promise<string|null>} - 2-letter country code or null
   */
  async getCountryForUser(userId, req) {
    try {
      // 1. Try Redis cache first
      if (this.redis) {
        const cached = await this.getFromCache(userId);
        if (cached) {
          logger.debug(`🌍 Cache hit for user ${userId.substring(0, 15)}...: ${cached}`);
          return cached;
        }
      }

      // 2. GeoIP lookup
      const country = this.getCountryFromRequest(req);

      if (country) {
        // 3. Cache the result
        await this.cacheCountry(userId, country);
        
        // 4. Update PostgreSQL (non-blocking)
        this.updateUserCountryInDB(userId, country).catch(err => {
          logger.error('🌍 ❌ Failed to update user country in DB:', err.message);
        });

        logger.info(`🌍 GeoIP detected: ${country} for user ${userId.substring(0, 15)}...`);
      }

      return country;
    } catch (error) {
      logger.error('🌍 ❌ Error getting country for user:', error.message);
      return null;
    }
  }

  /**
   * Get country from Redis cache
   * 
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} - Cached country or null
   */
  async getFromCache(userId) {
    try {
      if (!this.redis) return null;

      const key = `${this.cachePrefix}${userId}`;
      const cached = await this.redis.get(key);
      return cached;
    } catch (error) {
      logger.debug(`🌍 Cache read error: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache country in Redis
   * 
   * @param {string} userId - User ID
   * @param {string} country - 2-letter country code
   */
  async cacheCountry(userId, country) {
    try {
      if (!this.redis || !country) return;

      const key = `${this.cachePrefix}${userId}`;
      await this.redis.set(key, country, 'EX', this.cacheTTL);
      logger.debug(`🌍 Cached country ${country} for user ${userId.substring(0, 15)}...`);
    } catch (error) {
      logger.debug(`🌍 Cache write error: ${error.message}`);
    }
  }

  /**
   * Update user's country in PostgreSQL (users table)
   * Uses upsert to handle new users and updates
   * 
   * @param {string} userId - User ID
   * @param {string} country - 2-letter country code
   */
  async updateUserCountryInDB(userId, country) {
    try {
      if (!this.db || !userId || !country) return;

      // Upsert into users table (created by migration 011)
      const query = `
        INSERT INTO users (user_id, country, country_updated_at, created_at, last_seen)
        VALUES ($1, $2, NOW(), NOW(), NOW())
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          country = EXCLUDED.country,
          country_updated_at = NOW(),
          last_seen = NOW()
      `;

      await this.db.query(query, [userId, country]);
      logger.debug(`🌍 Updated DB: user ${userId.substring(0, 15)}... → ${country}`);
    } catch (error) {
      // Table might not exist yet - that's OK, will be created by migration
      if (error.code === '42P01') {
        logger.debug('🌍 users table not found (migration pending)');
      } else {
        logger.error('🌍 ❌ DB update error:', error.message);
      }
    }
  }

  /**
   * Get user's country from database (fallback when Redis is empty)
   * 
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} - Country code or null
   */
  async getCountryFromDB(userId) {
    try {
      if (!this.db || !userId) return null;

      const query = `
        SELECT country FROM users 
        WHERE user_id = $1
      `;

      const result = await this.db.query(query, [userId]);
      
      if (result.rows.length > 0 && result.rows[0].country) {
        return result.rows[0].country;
      }

      return null;
    } catch (error) {
      // Table might not exist yet
      if (error.code !== '42P01') {
        logger.error('🌍 ❌ DB read error:', error.message);
      }
      return null;
    }
  }
}

module.exports = GeolocationService;

