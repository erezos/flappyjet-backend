const logger = require('../utils/logger');
/**
 * 💾 Cache Manager Service
 * Redis-based caching with intelligent TTL and pattern-based invalidation
 */

class CacheManager {
  constructor(redisClient) {
    this.redis = redisClient;
    this.defaultTTL = 300; // 5 minutes
    this.keyPrefix = 'flappyjet:';
    
    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };
  }

  /**
   * Get value from cache
   */
  async get(key) {
    try {
      const prefixedKey = this._prefixKey(key);
      const value = await this.redis.get(prefixedKey);
      
      if (value !== null) {
        this.stats.hits++;
        try {
          return JSON.parse(value);
        } catch (parseError) {
          logger.warn('💾 ⚠️ Failed to parse cached value:', parseError.message);
          // Delete corrupted cache entry
          await this.redis.del(prefixedKey);
          this.stats.misses++;
          return null;
        }
      }
      
      this.stats.misses++;
      return null;
    } catch (error) {
      logger.error('💾 ❌ Cache get error:', error.message);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set(key, value, ttl = null) {
    try {
      const prefixedKey = this._prefixKey(key);
      const serializedValue = JSON.stringify(value);
      const effectiveTTL = ttl || this.defaultTTL;
      
      await this.redis.setex(prefixedKey, effectiveTTL, serializedValue);
      this.stats.sets++;
      
      return true;
    } catch (error) {
      logger.error('💾 ❌ Cache set error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Delete specific key from cache
   */
  async delete(key) {
    try {
      const prefixedKey = this._prefixKey(key);
      const result = await this.redis.del(prefixedKey);
      
      if (result > 0) {
        this.stats.deletes++;
      }
      
      return result > 0;
    } catch (error) {
      logger.error('💾 ❌ Cache delete error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Delete keys matching a pattern
   */
  async deletePattern(pattern) {
    try {
      const prefixedPattern = this._prefixKey(pattern);
      
      // Use SCAN to find matching keys (more efficient than KEYS)
      const keys = await this._scanKeys(prefixedPattern);
      
      if (keys.length > 0) {
        const result = await this.redis.del(...keys);
        this.stats.deletes += result;
        return result;
      }
      
      return 0;
    } catch (error) {
      logger.error('💾 ❌ Cache pattern delete error:', error.message);
      this.stats.errors++;
      return 0;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key) {
    try {
      const prefixedKey = this._prefixKey(key);
      const result = await this.redis.exists(prefixedKey);
      return result === 1;
    } catch (error) {
      logger.error('💾 ❌ Cache exists error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Get TTL for a key
   */
  async getTTL(key) {
    try {
      const prefixedKey = this._prefixKey(key);
      return await this.redis.ttl(prefixedKey);
    } catch (error) {
      logger.error('💾 ❌ Cache TTL error:', error.message);
      this.stats.errors++;
      return -1;
    }
  }

  /**
   * Extend TTL for a key
   */
  async expire(key, ttl) {
    try {
      const prefixedKey = this._prefixKey(key);
      const result = await this.redis.expire(prefixedKey, ttl);
      return result === 1;
    } catch (error) {
      logger.error('💾 ❌ Cache expire error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Increment a numeric value in cache
   */
  async increment(key, amount = 1, ttl = null) {
    try {
      const prefixedKey = this._prefixKey(key);
      const result = await this.redis.incrby(prefixedKey, amount);
      
      // Set TTL if this is a new key
      if (result === amount && ttl) {
        await this.redis.expire(prefixedKey, ttl);
      }
      
      return result;
    } catch (error) {
      logger.error('💾 ❌ Cache increment error:', error.message);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Get multiple keys at once
   */
  async getMultiple(keys) {
    try {
      const prefixedKeys = keys.map(key => this._prefixKey(key));
      const values = await this.redis.mget(...prefixedKeys);
      
      const result = {};
      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== null) {
          try {
            result[key] = JSON.parse(value);
            this.stats.hits++;
          } catch (parseError) {
            logger.warn('💾 ⚠️ Failed to parse cached value for key:', key);
            result[key] = null;
            this.stats.misses++;
          }
        } else {
          result[key] = null;
          this.stats.misses++;
        }
      });
      
      return result;
    } catch (error) {
      logger.error('💾 ❌ Cache getMultiple error:', error.message);
      this.stats.errors++;
      return {};
    }
  }

  /**
   * Set multiple keys at once
   */
  async setMultiple(keyValuePairs, ttl = null) {
    try {
      const pipeline = this.redis.pipeline();
      const effectiveTTL = ttl || this.defaultTTL;
      
      Object.entries(keyValuePairs).forEach(([key, value]) => {
        const prefixedKey = this._prefixKey(key);
        const serializedValue = JSON.stringify(value);
        pipeline.setex(prefixedKey, effectiveTTL, serializedValue);
      });
      
      await pipeline.exec();
      this.stats.sets += Object.keys(keyValuePairs).length;
      
      return true;
    } catch (error) {
      logger.error('💾 ❌ Cache setMultiple error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Clear all cache entries with our prefix
   */
  async clear() {
    try {
      const keys = await this._scanKeys(this.keyPrefix + '*');
      
      if (keys.length > 0) {
        const result = await this.redis.del(...keys);
        this.stats.deletes += result;
        return result;
      }
      
      return 0;
    } catch (error) {
      logger.error('💾 ❌ Cache clear error:', error.message);
      this.stats.errors++;
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : '0.00';
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      total: total
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };
  }

  /**
   * Health check for cache connection
   */
  async healthCheck() {
    try {
      const testKey = this._prefixKey('health_check');
      const testValue = { timestamp: Date.now() };
      
      // Test set
      await this.redis.setex(testKey, 10, JSON.stringify(testValue));
      
      // Test get
      const retrieved = await this.redis.get(testKey);
      const parsed = JSON.parse(retrieved);
      
      // Test delete
      await this.redis.del(testKey);
      
      return {
        status: 'healthy',
        latency: Date.now() - parsed.timestamp,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Private helper methods

  _prefixKey(key) {
    return key.startsWith(this.keyPrefix) ? key : this.keyPrefix + key;
  }

  async _scanKeys(pattern) {
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    return keys;
  }

  /**
   * Cache-aside pattern helper
   * Automatically handles cache miss by calling the provided function
   */
  async getOrSet(key, fetchFunction, ttl = null) {
    try {
      // Try to get from cache first
      let value = await this.get(key);
      
      if (value !== null) {
        return value;
      }
      
      // Cache miss - fetch the value
      value = await fetchFunction();
      
      if (value !== null && value !== undefined) {
        // Cache the result
        await this.set(key, value, ttl);
      }
      
      return value;
    } catch (error) {
      logger.error('💾 ❌ Cache getOrSet error:', error.message);
      this.stats.errors++;
      
      // On error, still try to call the fetch function
      try {
        return await fetchFunction();
      } catch (fetchError) {
        logger.error('💾 ❌ Fetch function error:', fetchError.message);
        throw fetchError;
      }
    }
  }

  /**
   * Batch cache operations for better performance
   */
  createBatch() {
    return new CacheBatch(this);
  }
}

/**
 * Batch operations for better performance
 */
class CacheBatch {
  constructor(cacheManager) {
    this.cache = cacheManager;
    this.operations = [];
  }

  get(key) {
    this.operations.push({ type: 'get', key });
    return this;
  }

  set(key, value, ttl = null) {
    this.operations.push({ type: 'set', key, value, ttl });
    return this;
  }

  delete(key) {
    this.operations.push({ type: 'delete', key });
    return this;
  }

  async execute() {
    const pipeline = this.cache.redis.pipeline();
    const getOperations = [];
    
    this.operations.forEach((op, index) => {
      const prefixedKey = this.cache._prefixKey(op.key);
      
      switch (op.type) {
        case 'get':
          pipeline.get(prefixedKey);
          getOperations.push({ index, key: op.key });
          break;
        case 'set':
          const serializedValue = JSON.stringify(op.value);
          const ttl = op.ttl || this.cache.defaultTTL;
          pipeline.setex(prefixedKey, ttl, serializedValue);
          break;
        case 'delete':
          pipeline.del(prefixedKey);
          break;
      }
    });
    
    const results = await pipeline.exec();
    
    // Process get operation results
    const getResults = {};
    getOperations.forEach(({ index, key }) => {
      const result = results[index];
      if (result[1] !== null) {
        try {
          getResults[key] = JSON.parse(result[1]);
          this.cache.stats.hits++;
        } catch (parseError) {
          getResults[key] = null;
          this.cache.stats.misses++;
        }
      } else {
        getResults[key] = null;
        this.cache.stats.misses++;
      }
    });
    
    // Update stats for other operations
    const setCount = this.operations.filter(op => op.type === 'set').length;
    const deleteCount = this.operations.filter(op => op.type === 'delete').length;
    
    this.cache.stats.sets += setCount;
    this.cache.stats.deletes += deleteCount;
    
    return {
      gets: getResults,
      operations: results.length,
      success: true
    };
  }
}

module.exports = { CacheManager, CacheBatch };
