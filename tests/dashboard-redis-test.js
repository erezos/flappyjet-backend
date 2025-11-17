/// 🧪 Dashboard API + Redis Caching Test
/// Tests the complete flow: Database → Cache → API Response

const Redis = require('ioredis');
const CacheManager = require('../services/cache-manager');

// Test configuration
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || 'redis://localhost:6379';
const TEST_TIMEOUT = 15000; // 15 seconds

console.log('🧪 Dashboard API + Redis Caching Tests');
console.log('=' .repeat(50));
console.log('');

// Helper function to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Test counter
let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
  try {
    console.log(`🧪 Testing: ${name}`);
    await testFn();
    console.log(`   ✅ TEST PASSED\n`);
    testsPassed++;
  } catch (error) {
    console.log(`   ❌ TEST FAILED: ${error.message}\n`);
    testsFailed++;
  }
}

async function main() {
  let redisClient = null;
  let cacheManager = null;

  try {
    // ============================================
    // TEST 1: Redis Connection
    // ============================================
    await runTest('Redis Connection', async () => {
      console.log(`   Redis URL: ${REDIS_URL?.substring(0, 30)}...`);
      
      redisClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
        connectTimeout: 10000,
        retryStrategy: (times) => {
          if (times > 5) return null;
          return Math.min(times * 200, 2000);
        }
      });

      // Wait for ready or timeout
      await Promise.race([
        new Promise((resolve) => {
          if (redisClient.status === 'ready') {
            resolve();
          } else {
            redisClient.once('ready', resolve);
          }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout')), 10000)
        )
      ]);

      console.log(`   Redis Status: ${redisClient.status}`);
      if (redisClient.status !== 'ready') {
        throw new Error('Redis not ready');
      }
    });

    // ============================================
    // TEST 2: CacheManager Initialization
    // ============================================
    await runTest('CacheManager Initialization', async () => {
      if (!redisClient || redisClient.status !== 'ready') {
        throw new Error('Redis not connected');
      }

      cacheManager = new CacheManager(redisClient);
      
      if (!cacheManager) {
        throw new Error('CacheManager not initialized');
      }
      
      if (!cacheManager.redis) {
        throw new Error('CacheManager.redis not set');
      }

      console.log('   CacheManager created with Redis client');
    });

    // ============================================
    // TEST 3: Basic Cache Operations (SET/GET)
    // ============================================
    await runTest('Basic Cache Operations', async () => {
      if (!cacheManager) {
        throw new Error('CacheManager not available');
      }

      const testKey = 'test-key-' + Date.now();
      const testValue = { message: 'Hello Cache!', timestamp: Date.now() };

      // SET
      const setResult = await cacheManager.set(testKey, testValue, 60); // 60 seconds TTL
      if (!setResult) {
        throw new Error('Cache SET failed');
      }
      console.log('   ✅ Cache SET successful');

      // GET
      const getValue = await cacheManager.get(testKey);
      if (!getValue) {
        throw new Error('Cache GET returned null');
      }
      
      if (getValue.message !== testValue.message) {
        throw new Error('Cache value mismatch');
      }
      console.log('   ✅ Cache GET successful');

      // Cleanup
      await cacheManager.delete(testKey);
      console.log('   ✅ Cache DELETE successful');
    });

    // ============================================
    // TEST 4: Cache Expiration (TTL)
    // ============================================
    await runTest('Cache TTL Expiration', async () => {
      if (!cacheManager) {
        throw new Error('CacheManager not available');
      }

      const testKey = 'test-ttl-' + Date.now();
      const testValue = { data: 'expires soon' };

      // SET with 2 second TTL
      await cacheManager.set(testKey, testValue, 2);
      console.log('   ✅ Set cache with 2s TTL');

      // Immediate GET should work
      let value = await cacheManager.get(testKey);
      if (!value) {
        throw new Error('Cache should still exist');
      }
      console.log('   ✅ Cache exists immediately');

      // Wait 3 seconds
      console.log('   ⏳ Waiting 3 seconds for expiration...');
      await sleep(3000);

      // GET after expiration should return null
      value = await cacheManager.get(testKey);
      if (value !== null) {
        throw new Error('Cache should have expired');
      }
      console.log('   ✅ Cache expired correctly');
    });

    // ============================================
    // TEST 5: Dashboard Cache Keys
    // ============================================
    await runTest('Dashboard Cache Keys', async () => {
      if (!cacheManager) {
        throw new Error('CacheManager not available');
      }

      // Test the cache keys that dashboard-api uses
      const dashboardKeys = [
        'dashboard-overview',
        'top-events-10',
        'user-retention',
        'revenue-metrics'
      ];

      for (const key of dashboardKeys) {
        const testData = {
          cached_at: new Date().toISOString(),
          data: `Mock data for ${key}`
        };

        // SET
        const setOk = await cacheManager.set(key, testData, 300); // 5 min TTL
        if (!setOk) {
          throw new Error(`Failed to set cache for ${key}`);
        }

        // GET
        const getValue = await cacheManager.get(key);
        if (!getValue) {
          throw new Error(`Failed to get cache for ${key}`);
        }

        console.log(`   ✅ ${key}: SET and GET successful`);

        // Cleanup
        await cacheManager.delete(key);
      }
    });

    // ============================================
    // TEST 6: Production Backend Health Check
    // ============================================
    await runTest('Production Backend Health Check', async () => {
      const fetch = (await import('node-fetch')).default;
      const backendUrl = 'https://flappyjet-backend-production.up.railway.app/health';
      
      console.log(`   Checking: ${backendUrl}`);
      const response = await fetch(backendUrl);
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('   Status:', data.status);
      console.log('   Version:', data.version);
      console.log('   Environment:', data.environment);
      
      if (data.services) {
        console.log('   Services:', JSON.stringify(data.services, null, 2));
      }

      if (data.status !== 'healthy') {
        throw new Error('Backend not healthy');
      }
    });

    // ============================================
    // TEST 7: Production Dashboard API
    // ============================================
    await runTest('Production Dashboard API', async () => {
      const fetch = (await import('node-fetch')).default;
      const apiUrl = 'https://flappyjet-backend-production.up.railway.app/api/dashboard/overview';
      
      console.log(`   Checking: ${apiUrl}`);
      
      // First request (should hit database)
      console.log('   🔵 Request 1: Database hit (cache miss expected)');
      const start1 = Date.now();
      const response1 = await fetch(apiUrl);
      const time1 = Date.now() - start1;
      
      if (!response1.ok) {
        throw new Error(`Dashboard API failed: ${response1.status} ${await response1.text()}`);
      }

      const data1 = await response1.json();
      console.log(`   ⏱️ Response time: ${time1}ms`);
      console.log(`   📊 Active users: ${data1.activeUsers || 0}`);
      console.log(`   📊 Total events: ${data1.totalEvents || 0}`);

      // Wait 500ms
      await sleep(500);

      // Second request (should hit cache)
      console.log('   🟢 Request 2: Cache hit expected');
      const start2 = Date.now();
      const response2 = await fetch(apiUrl);
      const time2 = Date.now() - start2;
      
      if (!response2.ok) {
        throw new Error(`Dashboard API failed on 2nd request: ${response2.status}`);
      }

      const data2 = await response2.json();
      console.log(`   ⏱️ Response time: ${time2}ms`);

      // Cache hit should be faster (typically < 50ms vs 100-500ms for DB)
      if (time2 < time1) {
        console.log(`   🚀 Cache speedup: ${time1 - time2}ms faster (${Math.round((time1 - time2) / time1 * 100)}% improvement)`);
      } else {
        console.log(`   ⚠️ No speedup detected (cache might not be working)`);
      }
    });

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    // Cleanup
    if (redisClient) {
      try {
        await redisClient.quit();
        console.log('\n💾 Redis connection closed');
      } catch (err) {
        console.error('❌ Error closing Redis:', err);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  console.log('');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total: ${testsPassed + testsFailed}`);
  console.log('');

  // Exit code
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
main().catch(error => {
  console.error('🚨 Unhandled error:', error);
  process.exit(1);
});

