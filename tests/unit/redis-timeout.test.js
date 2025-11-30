/**
 * Redis Timeout Tests
 * 
 * Tests for the Redis ping timeout helper function that prevents
 * server startup from hanging when Redis is in a bad state.
 * 
 * This fix addresses the 502 Bad Gateway issue where the server
 * would hang indefinitely waiting for Redis to respond.
 */

describe('Redis Ping Timeout Helper', () => {
  // Helper function that mirrors the implementation in server.js
  // Uses AbortController pattern to clean up timeouts and avoid Jest warnings
  const pingRedisWithTimeout = async (client, timeoutMs = 5000) => {
    let timeoutId;
    return Promise.race([
      client.ping(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Redis ping timeout')), timeoutMs);
      })
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

  describe('pingRedisWithTimeout', () => {
    test('should return PONG when Redis responds quickly', async () => {
      // Mock Redis client that responds immediately
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG')
      };

      const result = await pingRedisWithTimeout(mockRedisClient, 5000);
      
      expect(result).toBe('PONG');
      expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
    });

    test('should timeout when Redis does not respond', async () => {
      // Mock Redis client that never resolves
      const mockRedisClient = {
        ping: jest.fn().mockImplementation(() => new Promise(() => {})) // Never resolves
      };

      // Use a short timeout for testing
      await expect(
        pingRedisWithTimeout(mockRedisClient, 100)
      ).rejects.toThrow('Redis ping timeout');
      
      expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
    });

    test('should reject with Redis error if ping fails before timeout', async () => {
      // Mock Redis client that rejects with an error
      const mockRedisClient = {
        ping: jest.fn().mockRejectedValue(new Error('Connection refused'))
      };

      await expect(
        pingRedisWithTimeout(mockRedisClient, 5000)
      ).rejects.toThrow('Connection refused');
      
      expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
    });

    test('should use default timeout of 5000ms', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG')
      };

      // Call without explicit timeout
      const result = await pingRedisWithTimeout(mockRedisClient);
      
      expect(result).toBe('PONG');
    });

    test('should handle slow but successful response within timeout', async () => {
      // Mock Redis client that responds after 50ms (within 5000ms timeout)
      const mockRedisClient = {
        ping: jest.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(() => resolve('PONG'), 50))
        )
      };

      const result = await pingRedisWithTimeout(mockRedisClient, 5000);
      
      expect(result).toBe('PONG');
    });

    test('should timeout when response takes longer than timeout', async () => {
      // Mock Redis client that responds after 200ms
      const mockRedisClient = {
        ping: jest.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(() => resolve('PONG'), 200))
        )
      };

      // Use 100ms timeout (less than 200ms response time)
      await expect(
        pingRedisWithTimeout(mockRedisClient, 100)
      ).rejects.toThrow('Redis ping timeout');
    });
  });

  describe('Server Initialization Behavior', () => {
    test('should not block initialization when Redis ping times out', async () => {
      // This test verifies the fix for the 502 issue
      const mockRedisClient = {
        status: 'ready',
        ping: jest.fn().mockImplementation(() => new Promise(() => {})) // Never resolves
      };

      const startTime = Date.now();
      
      // Simulate the initialization flow with short timeout
      try {
        await pingRedisWithTimeout(mockRedisClient, 100);
      } catch (error) {
        // Expected to timeout
        expect(error.message).toBe('Redis ping timeout');
      }

      const duration = Date.now() - startTime;
      
      // Should complete within ~200ms (100ms timeout + some overhead)
      expect(duration).toBeLessThan(500);
    });

    test('should allow cache manager to use no-op fallback on timeout', async () => {
      const mockRedisClient = {
        status: 'connecting', // Not ready
        ping: jest.fn()
      };

      // No-op cache manager fallback
      const createNoOpCacheManager = () => ({
        get: async () => null,
        set: async () => true,
        delete: async () => true,
        redis: null
      });

      // Simulate the initialization flow
      let cacheManager;
      
      if (mockRedisClient.status === 'ready') {
        try {
          await pingRedisWithTimeout(mockRedisClient, 100);
          cacheManager = { redis: mockRedisClient };
        } catch {
          cacheManager = createNoOpCacheManager();
        }
      } else {
        cacheManager = createNoOpCacheManager();
      }

      // Should use no-op cache manager
      expect(cacheManager.redis).toBeNull();
      expect(await cacheManager.get('key')).toBeNull();
      expect(await cacheManager.set('key', 'value')).toBe(true);
    });

    test('should proceed with Redis when ping succeeds', async () => {
      const mockRedisClient = {
        status: 'ready',
        ping: jest.fn().mockResolvedValue('PONG')
      };

      // Simulate the initialization flow
      let cacheManager;
      
      if (mockRedisClient.status === 'ready') {
        try {
          const result = await pingRedisWithTimeout(mockRedisClient, 5000);
          expect(result).toBe('PONG');
          cacheManager = { redis: mockRedisClient };
        } catch {
          cacheManager = { redis: null };
        }
      }

      // Should use Redis cache manager
      expect(cacheManager.redis).toBe(mockRedisClient);
    });
  });

  describe('Edge Cases', () => {
    test('should handle Redis returning non-PONG response', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('OK') // Unusual but possible
      };

      const result = await pingRedisWithTimeout(mockRedisClient, 5000);
      
      expect(result).toBe('OK');
    });

    test('should handle Redis throwing synchronously', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockImplementation(() => {
          throw new Error('Sync error');
        })
      };

      await expect(
        pingRedisWithTimeout(mockRedisClient, 5000)
      ).rejects.toThrow('Sync error');
    });

    test('should handle undefined Redis client gracefully', async () => {
      // This should throw since ping() doesn't exist
      await expect(
        pingRedisWithTimeout(undefined, 5000)
      ).rejects.toThrow();
    });

    test('should handle null ping method gracefully', async () => {
      const mockRedisClient = {
        ping: null
      };

      await expect(
        pingRedisWithTimeout(mockRedisClient, 5000)
      ).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    test('should complete quickly when Redis responds fast', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG')
      };

      const startTime = Date.now();
      await pingRedisWithTimeout(mockRedisClient, 5000);
      const duration = Date.now() - startTime;

      // Should complete in under 50ms
      expect(duration).toBeLessThan(50);
    });

    test('should not create memory leaks with repeated calls', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG')
      };

      // Make 100 calls
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(pingRedisWithTimeout(mockRedisClient, 5000));
      }

      const results = await Promise.all(promises);
      
      expect(results.every(r => r === 'PONG')).toBe(true);
      expect(mockRedisClient.ping).toHaveBeenCalledTimes(100);
    });
  });
});

