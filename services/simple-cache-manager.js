/**
 * Simple In-Memory Cache Manager
 * Lightweight caching for tournament system
 */

class SimpleCacheManager {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  /**
   * Get value from cache
   */
  async get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set value in cache with optional TTL
   */
  async set(key, value, ttlSeconds = null) {
    const entry = {
      value: value,
      createdAt: Date.now(),
      expiresAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null
    };

    this.cache.set(key, entry);

    // Set expiration timer if TTL provided
    if (ttlSeconds) {
      // Clear existing timer if any
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
      }

      // Set new timer
      const timer = setTimeout(() => {
        this.delete(key);
      }, ttlSeconds * 1000);

      this.timers.set(key, timer);
    }

    return true;
  }

  /**
   * Delete value from cache
   */
  async delete(key) {
    // Clear timer if exists
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  async clear() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.cache.clear();
    this.timers.clear();
    return true;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      memoryUsage: this._estimateMemoryUsage()
    };
  }

  /**
   * Check if key exists in cache
   */
  async has(key) {
    return this.cache.has(key) && (await this.get(key)) !== null;
  }

  /**
   * Get all keys in cache
   */
  async keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Estimate memory usage (rough calculation)
   */
  _estimateMemoryUsage() {
    let totalSize = 0;
    
    for (const [key, entry] of this.cache) {
      totalSize += key.length * 2; // Rough string size
      totalSize += JSON.stringify(entry.value).length * 2; // Rough object size
      totalSize += 64; // Overhead for entry metadata
    }

    return {
      bytes: totalSize,
      kb: Math.round(totalSize / 1024),
      mb: Math.round(totalSize / (1024 * 1024))
    };
  }

  /**
   * Cleanup expired entries (manual cleanup)
   */
  cleanup() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.delete(key);
    }

    return expiredKeys.length;
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats() {
    const now = Date.now();
    let expiredCount = 0;
    let totalSize = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        expiredCount++;
      }
      totalSize += JSON.stringify(entry).length;
    }

    return {
      totalKeys: this.cache.size,
      expiredKeys: expiredCount,
      activeKeys: this.cache.size - expiredCount,
      memoryUsage: this._estimateMemoryUsage(),
      hitRate: this._calculateHitRate()
    };
  }

  /**
   * Calculate cache hit rate (simplified)
   */
  _calculateHitRate() {
    // This is a simplified implementation
    // In production, you'd want to track hits/misses over time
    return {
      note: 'Hit rate tracking requires additional instrumentation',
      totalEntries: this.cache.size
    };
  }

  /**
   * Bulk delete by pattern
   */
  async deletePattern(pattern) {
    const regex = new RegExp(pattern);
    const keysToDelete = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }

    return keysToDelete.length;
  }
}

module.exports = SimpleCacheManager;
