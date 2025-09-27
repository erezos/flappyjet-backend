/// 🌍 GeoIP Service - IP-based Country Detection
/// 
/// Provides accurate country detection from IP addresses using multiple providers.
/// Includes fallback mechanisms and caching for production reliability.

const axios = require('axios');
const logger = require('../utils/logger');

class GeoIPService {
  static cache = new Map();
  static cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Get country code from IP address with multiple fallback providers
   * @param {string} ip - IP address to lookup
   * @returns {Promise<string|null>} - Country code (e.g., 'US') or null if failed
   */
  static async getCountryFromIP(ip) {
    if (!ip || this.isPrivateIP(ip)) {
      return null;
    }

    // Check cache first
    const cached = this.getCachedResult(ip);
    if (cached) {
      logger.info(`🌍 GeoIP cache hit for ${ip}: ${cached}`);
      return cached;
    }

    // Try multiple providers in order of preference
    const providers = [
      () => this.tryIPAPI(ip),
      () => this.tryIPInfo(ip),
      () => this.tryIPGeolocation(ip),
    ];

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result) {
          this.setCachedResult(ip, result);
          logger.info(`🌍 GeoIP success for ${ip}: ${result}`);
          return result;
        }
      } catch (error) {
        logger.warn(`🌍 GeoIP provider failed for ${ip}:`, error.message);
      }
    }

    logger.warn(`🌍 All GeoIP providers failed for ${ip}`);
    return null;
  }

  /**
   * Try ip-api.com (free tier: 1000 requests/month)
   */
  static async tryIPAPI(ip) {
    const response = await axios.get(
      `http://ip-api.com/json/${ip}?fields=countryCode,status`,
      { timeout: 3000 }
    );

    if (response.data && response.data.status === 'success' && response.data.countryCode) {
      return response.data.countryCode;
    }
    return null;
  }

  /**
   * Try ipinfo.io (free tier: 50,000 requests/month)
   */
  static async tryIPInfo(ip) {
    // Note: You can add your ipinfo.io token as environment variable
    const token = process.env.IPINFO_TOKEN || '';
    const url = token 
      ? `https://ipinfo.io/${ip}/country?token=${token}`
      : `https://ipinfo.io/${ip}/country`;

    const response = await axios.get(url, { timeout: 3000 });

    if (response.data && typeof response.data === 'string') {
      const countryCode = response.data.trim();
      if (countryCode.length === 2) {
        return countryCode;
      }
    }
    return null;
  }

  /**
   * Try ipgeolocation.io (free tier: 1000 requests/month)
   */
  static async tryIPGeolocation(ip) {
    // Note: You can add your ipgeolocation.io API key as environment variable
    const apiKey = process.env.IPGEOLOCATION_API_KEY || '';
    if (!apiKey) return null; // Skip if no API key

    const response = await axios.get(
      `https://api.ipgeolocation.io/ipgeo?apiKey=${apiKey}&ip=${ip}&fields=country_code2`,
      { timeout: 3000 }
    );

    if (response.data && response.data.country_code2) {
      return response.data.country_code2;
    }
    return null;
  }

  /**
   * Check if IP is private/local
   */
  static isPrivateIP(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return true;
    
    // IPv4 private ranges
    if (ip.startsWith('192.168.') || 
        ip.startsWith('10.') || 
        ip.startsWith('172.')) return true;
    
    // IPv6 private ranges
    if (ip.startsWith('fc00:') || 
        ip.startsWith('fd00:') || 
        ip.startsWith('fe80:')) return true;
    
    return false;
  }

  /**
   * Get cached result
   */
  static getCachedResult(ip) {
    const cached = this.cache.get(ip);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.countryCode;
    }
    
    // Remove expired cache
    if (cached) {
      this.cache.delete(ip);
    }
    
    return null;
  }

  /**
   * Set cached result
   */
  static setCachedResult(ip, countryCode) {
    this.cache.set(ip, {
      countryCode,
      timestamp: Date.now()
    });
  }

  /**
   * Clear cache (useful for testing)
   */
  static clearCache() {
    this.cache.clear();
    logger.info('🌍 GeoIP cache cleared');
  }

  /**
   * Get cache statistics
   */
  static getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([ip, data]) => ({
        ip,
        countryCode: data.countryCode,
        age: Date.now() - data.timestamp
      }))
    };
  }

  /**
   * Extract real IP from request (handles proxies, load balancers)
   */
  static extractRealIP(req) {
    // Check various headers for real IP
    const forwarded = req.headers['x-forwarded-for'];
    const realIP = req.headers['x-real-ip'];
    const cfConnectingIP = req.headers['cf-connecting-ip']; // Cloudflare
    
    if (forwarded) {
      // x-forwarded-for can contain multiple IPs, take the first one
      return forwarded.split(',')[0].trim();
    }
    
    if (realIP) {
      return realIP;
    }
    
    if (cfConnectingIP) {
      return cfConnectingIP;
    }
    
    // Fallback to connection remote address
    return req.connection?.remoteAddress || req.socket?.remoteAddress || null;
  }
}

module.exports = GeoIPService;
