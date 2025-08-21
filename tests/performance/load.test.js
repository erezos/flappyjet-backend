/// 🧪 Performance and Load Tests
const request = require('supertest');
const app = require('../../server');

describe('Performance Tests', () => {
  let testTokens = [];
  let testPlayers = [];

  beforeAll(async () => {
    // Create multiple test players for load testing
    if (global.testConfig.dbPool) {
      for (let i = 0; i < 10; i++) {
        const player = await global.testHelpers.createTestPlayer({
          device_id: `load_test_device_${i}`,
          nickname: `LoadTestPlayer${i}`
        });
        testPlayers.push(player);
        testTokens.push(global.testHelpers.generateTestToken(player.id));
      }
    }
  });

  describe('Response Time Tests', () => {
    it('should respond to health check within 100ms', async () => {
      const start = Date.now();
      
      const response = await request(app)
        .get('/health');
      
      const duration = Date.now() - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(100);
    });

    it('should respond to authentication within 500ms', async () => {
      const start = Date.now();
      
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          deviceId: `perf_test_${Date.now()}`,
          nickname: 'PerfTestPlayer',
          platform: 'test'
        });
      
      const duration = Date.now() - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);
    });

    it('should respond to leaderboard requests within 1000ms', async () => {
      const start = Date.now();
      
      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 100 });
      
      const duration = Date.now() - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });

    it('should respond to score submission within 300ms', async () => {
      if (testTokens.length === 0) {
        console.log('🧪 Skipping score submission test (no test tokens)');
        return;
      }

      const start = Date.now();
      
      const response = await request(app)
        .post('/api/leaderboard/submit')
        .set('Authorization', `Bearer ${testTokens[0]}`)
        .send({
          score: 42,
          survivalTime: 30,
          gameDuration: 30000
        });
      
      const duration = Date.now() - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(300);
    });
  });

  describe('Concurrent Request Tests', () => {
    it('should handle 50 concurrent health checks', async () => {
      const promises = [];
      
      for (let i = 0; i < 50; i++) {
        promises.push(request(app).get('/health'));
      }
      
      const start = Date.now();
      const responses = await Promise.all(promises);
      const duration = Date.now() - start;
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000);
    });

    it('should handle concurrent registrations', async () => {
      const promises = [];
      
      for (let i = 0; i < 20; i++) {
        promises.push(
          request(app)
            .post('/api/auth/register')
            .send({
              deviceId: `concurrent_test_${Date.now()}_${i}`,
              nickname: `ConcurrentPlayer${i}`,
              platform: 'test'
            })
        );
      }
      
      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    it('should handle concurrent score submissions from different players', async () => {
      if (testTokens.length < 5) {
        console.log('🧪 Skipping concurrent score test (insufficient test tokens)');
        return;
      }

      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${testTokens[i]}`)
            .send({
              score: 20 + i,
              survivalTime: 15 + i,
              gameDuration: 15000 + i * 1000
            })
        );
      }
      
      const responses = await Promise.all(promises);
      
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    it('should handle concurrent leaderboard requests', async () => {
      const promises = [];
      
      for (let i = 0; i < 30; i++) {
        promises.push(
          request(app)
            .get('/api/leaderboard/global')
            .query({ 
              limit: 50,
              offset: i * 10,
              period: i % 2 === 0 ? 'weekly' : 'all_time'
            })
        );
      }
      
      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('Memory and Resource Tests', () => {
    it('should not leak memory during repeated requests', async () => {
      const initialMemory = process.memoryUsage();
      
      // Make many requests
      for (let i = 0; i < 100; i++) {
        await request(app).get('/health');
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      
      // Memory usage shouldn't increase dramatically
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePercent = (memoryIncrease / initialMemory.heapUsed) * 100;
      
      expect(memoryIncreasePercent).toBeLessThan(50); // Less than 50% increase
    });

    it('should handle large payloads efficiently', async () => {
      const largePayload = {
        deviceId: 'large_payload_test',
        nickname: 'LargePayloadPlayer',
        platform: 'test',
        // Add some large data
        metadata: 'x'.repeat(1000) // 1KB of data
      };
      
      const start = Date.now();
      
      const response = await request(app)
        .post('/api/auth/register')
        .send(largePayload);
      
      const duration = Date.now() - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Database Performance Tests', () => {
    it('should handle rapid database queries efficiently', async () => {
      if (!global.testConfig.dbPool) {
        console.log('🧪 Skipping database performance test (no DB connection)');
        return;
      }

      const promises = [];
      
      // Create multiple players rapidly
      for (let i = 0; i < 20; i++) {
        promises.push(
          request(app)
            .post('/api/auth/register')
            .send({
              deviceId: `db_perf_test_${Date.now()}_${i}`,
              nickname: `DBPerfPlayer${i}`,
              platform: 'test'
            })
        );
      }
      
      const start = Date.now();
      const responses = await Promise.all(promises);
      const duration = Date.now() - start;
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds max
    });

    it('should maintain performance with large leaderboard queries', async () => {
      const start = Date.now();
      
      const response = await request(app)
        .get('/api/leaderboard/global')
        .query({ limit: 500 }); // Large query
      
      const duration = Date.now() - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(2000); // Should be fast even for large queries
    });
  });

  describe('Rate Limiting Performance', () => {
    it('should handle rate limiting efficiently', async () => {
      const promises = [];
      
      // Make requests that will trigger rate limiting
      for (let i = 0; i < 120; i++) { // Exceed 100 req/min limit
        promises.push(
          request(app)
            .get('/health')
            .expect((res) => {
              // Should be either 200 (allowed) or 429 (rate limited)
              expect([200, 429]).toContain(res.status);
            })
        );
      }
      
      const start = Date.now();
      await Promise.all(promises);
      const duration = Date.now() - start;
      
      // Rate limiting shouldn't significantly slow down responses
      expect(duration).toBeLessThan(5000);
    });

    it('should recover from rate limiting quickly', async () => {
      // First, trigger rate limiting
      const rapidRequests = [];
      for (let i = 0; i < 110; i++) {
        rapidRequests.push(request(app).get('/health'));
      }
      await Promise.all(rapidRequests);
      
      // Wait a bit for rate limit to reset
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Should be able to make requests again
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
    });
  });

  describe('Stress Tests', () => {
    it('should handle sustained load', async () => {
      const duration = 5000; // 5 seconds
      const requestInterval = 100; // Request every 100ms
      const expectedRequests = duration / requestInterval;
      
      let completedRequests = 0;
      let errors = 0;
      
      const startTime = Date.now();
      
      const makeRequest = async () => {
        try {
          const response = await request(app).get('/health');
          if (response.status === 200) {
            completedRequests++;
          } else {
            errors++;
          }
        } catch (error) {
          errors++;
        }
      };
      
      // Start making requests at regular intervals
      const interval = setInterval(makeRequest, requestInterval);
      
      // Stop after duration
      setTimeout(() => {
        clearInterval(interval);
      }, duration);
      
      // Wait for all requests to complete
      await new Promise(resolve => setTimeout(resolve, duration + 1000));
      
      const actualDuration = Date.now() - startTime;
      
      // Should handle most requests successfully
      const successRate = completedRequests / (completedRequests + errors);
      expect(successRate).toBeGreaterThan(0.8); // 80% success rate minimum
      
      console.log(`🧪 Stress test: ${completedRequests} successful requests, ${errors} errors in ${actualDuration}ms`);
    });

    it('should maintain data consistency under load', async () => {
      if (!global.testConfig.dbPool || testTokens.length === 0) {
        console.log('🧪 Skipping consistency stress test (no DB or tokens)');
        return;
      }

      const promises = [];
      const scoreValues = [];
      
      // Submit many scores concurrently
      for (let i = 0; i < 10; i++) {
        const score = 50 + i;
        scoreValues.push(score);
        
        promises.push(
          request(app)
            .post('/api/leaderboard/submit')
            .set('Authorization', `Bearer ${testTokens[0]}`)
            .send({
              score,
              survivalTime: 30 + i,
              gameDuration: 30000 + i * 1000
            })
        );
      }
      
      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      // Check that the highest score is recorded correctly
      const profileResponse = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${testTokens[0]}`);
      
      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.player.best_score).toBe(Math.max(...scoreValues));
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle invalid requests efficiently', async () => {
      const promises = [];
      
      for (let i = 0; i < 50; i++) {
        promises.push(
          request(app)
            .post('/api/auth/register')
            .send({
              // Invalid data
              deviceId: '', // Too short
              nickname: '',
              platform: 'invalid'
            })
        );
      }
      
      const start = Date.now();
      const responses = await Promise.all(promises);
      const duration = Date.now() - start;
      
      // All should fail with 400
      responses.forEach(response => {
        expect(response.status).toBe(400);
      });
      
      // Should handle errors quickly
      expect(duration).toBeLessThan(2000);
    });

    it('should handle malformed JSON efficiently', async () => {
      const promises = [];
      
      for (let i = 0; i < 30; i++) {
        promises.push(
          request(app)
            .post('/api/auth/register')
            .set('Content-Type', 'application/json')
            .send('invalid-json{')
        );
      }
      
      const start = Date.now();
      const responses = await Promise.all(promises);
      const duration = Date.now() - start;
      
      // All should fail with 400
      responses.forEach(response => {
        expect(response.status).toBe(400);
      });
      
      // Should handle malformed requests quickly
      expect(duration).toBeLessThan(1500);
    });
  });
});
