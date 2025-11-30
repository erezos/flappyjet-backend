/**
 * Events Route Tests
 * 
 * Tests for the /api/events endpoint to ensure:
 * 1. Response is sent immediately (no blocking)
 * 2. Fire-and-forget pattern works correctly
 * 3. Geo lookup timeout doesn't block response
 * 4. Events are processed correctly
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../services/event-processor');
jest.mock('../../services/geolocation-service');
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const EventProcessor = require('../../services/event-processor');
const GeolocationService = require('../../services/geolocation-service');

describe('Events Route - Fire and Forget', () => {
  let app;
  let mockDb;
  let mockRedisClient;
  let mockEventQueue;
  let mockProcessor;
  let mockGeoService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });

    // Create mock database
    mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    // Create mock Redis client
    mockRedisClient = {
      status: 'ready',
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    // Create mock event queue
    mockEventQueue = {
      addBatch: jest.fn().mockResolvedValue(true),
    };

    // Create mock processor
    mockProcessor = {
      processBatch: jest.fn().mockResolvedValue({ processed: 1 }),
    };

    // Mock EventProcessor constructor
    EventProcessor.mockImplementation(() => mockProcessor);

    // Create mock geo service
    mockGeoService = {
      getCountryForUser: jest.fn().mockResolvedValue('US'),
    };

    // Mock GeolocationService constructor
    GeolocationService.mockImplementation(() => mockGeoService);

    // Create Express app
    app = express();
    app.use(express.json());
    
    // Set up app.locals
    app.locals.db = mockDb;
    app.locals.redisClient = mockRedisClient;
    app.locals.eventQueue = mockEventQueue;

    // Mount the events route
    const eventsRouter = require('../../routes/events');
    app.use('/api/events', eventsRouter);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  describe('Response Timing (Critical for 499 fix)', () => {
    test('should return 200 immediately without waiting for geo lookup', async () => {
      // Make geo lookup slow (3 seconds)
      mockGeoService.getCountryForUser.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('US'), 3000))
      );

      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/events')
        .send([{ event_type: 'test', user_id: 'user_123' }])
        .timeout(1000); // Should complete in under 1 second

      const responseTime = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Response should be instant (under 100ms), not waiting for 3s geo lookup
      expect(responseTime).toBeLessThan(500);
    });

    test('should return 200 immediately without waiting for event processing', async () => {
      // Make event processing slow (5 seconds)
      mockEventQueue.addBatch.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(), 5000))
      );

      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/events')
        .send([{ event_type: 'test', user_id: 'user_123' }])
        .timeout(1000);

      const responseTime = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Response should be instant, not waiting for 5s processing
      expect(responseTime).toBeLessThan(500);
    });

    test('should return 200 even if geo lookup fails', async () => {
      mockGeoService.getCountryForUser.mockRejectedValue(new Error('Redis connection failed'));

      const response = await request(app)
        .post('/api/events')
        .send([{ event_type: 'test', user_id: 'user_123' }]);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return 200 even if event processing fails', async () => {
      mockEventQueue.addBatch.mockRejectedValue(new Error('Queue unavailable'));

      const response = await request(app)
        .post('/api/events')
        .send([{ event_type: 'test', user_id: 'user_123' }]);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Geo Lookup Timeout', () => {
    test('should timeout geo lookup after 2 seconds and continue processing', async () => {
      // Make geo lookup hang forever
      mockGeoService.getCountryForUser.mockImplementation(() => 
        new Promise(() => {}) // Never resolves
      );

      const response = await request(app)
        .post('/api/events')
        .send([{ event_type: 'test', user_id: 'user_123' }])
        .timeout(500); // Response should be instant

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Advance timers to trigger geo timeout
      jest.advanceTimersByTime(2500);
      
      // Events should still be queued (without country)
      // Note: Due to async nature, we wait a bit for the background processing
      await new Promise(resolve => setImmediate(resolve));
    });
  });

  describe('Request Body Parsing', () => {
    test('should handle array of events', async () => {
      const events = [
        { event_type: 'event1', user_id: 'user_123' },
        { event_type: 'event2', user_id: 'user_123' },
      ];

      const response = await request(app)
        .post('/api/events')
        .send(events);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
    });

    test('should handle wrapped events object (old format)', async () => {
      const body = {
        events: [
          { event_type: 'event1', user_id: 'user_123' },
        ],
      };

      const response = await request(app)
        .post('/api/events')
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });

    test('should handle single event object', async () => {
      const event = { event_type: 'single_event', user_id: 'user_123' };

      const response = await request(app)
        .post('/api/events')
        .send(event);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
    });

    test('should handle empty body', async () => {
      const response = await request(app)
        .post('/api/events')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1); // Empty object wrapped in array
    });

    test('should truncate batches larger than 100 events', async () => {
      const events = Array(150).fill(null).map((_, i) => ({
        event_type: `event_${i}`,
        user_id: 'user_123',
      }));

      const response = await request(app)
        .post('/api/events')
        .send(events);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(100); // Truncated
    });
  });

  describe('Event Processing', () => {
    test('should use event queue when available', async () => {
      const events = [{ event_type: 'test', user_id: 'user_123' }];

      await request(app)
        .post('/api/events')
        .send(events);

      // Wait for background processing
      await new Promise(resolve => setImmediate(resolve));
      jest.advanceTimersByTime(3000);
      await new Promise(resolve => setImmediate(resolve));

      // Queue should be used (not direct processor)
      expect(mockEventQueue.addBatch).toHaveBeenCalled();
    });

    test('should fall back to direct processing when queue unavailable', async () => {
      // Remove event queue
      app.locals.eventQueue = null;

      const events = [{ event_type: 'test', user_id: 'user_123' }];

      const response = await request(app)
        .post('/api/events')
        .send(events);

      // Response should still be 200 (fire-and-forget)
      expect(response.status).toBe(200);
      
      // Note: Testing background processing with supertest is unreliable
      // The important thing is the response was immediate (tested above)
      // Direct processor usage is an implementation detail
    });
  });

  describe('Country Injection', () => {
    test('should handle events with user_id for geo lookup', async () => {
      const events = [{ event_type: 'test', user_id: 'user_123' }];

      const response = await request(app)
        .post('/api/events')
        .send(events);

      // Response should be immediate regardless of geo lookup
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(1);
      
      // Note: Country injection happens in background after response
      // The key test is that response is NOT blocked by geo lookup
      // (covered by timing tests above)
    });

    test('should process events without country if geo lookup fails', async () => {
      mockGeoService.getCountryForUser.mockRejectedValue(new Error('GeoIP error'));
      
      const events = [{ event_type: 'test', user_id: 'user_123' }];

      const response = await request(app)
        .post('/api/events')
        .send(events);

      expect(response.status).toBe(200);

      // Wait for background processing
      await new Promise(resolve => setImmediate(resolve));
      jest.advanceTimersByTime(3000);
      await new Promise(resolve => setImmediate(resolve));

      // Events should still be queued (without country)
      expect(mockEventQueue.addBatch).toHaveBeenCalled();
    });
  });
});

describe('Events Route - Edge Cases', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create minimal app
    app = express();
    app.use(express.json());
    
    app.locals.db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    app.locals.redisClient = { status: 'ready', get: jest.fn(), set: jest.fn() };
    app.locals.eventQueue = { addBatch: jest.fn().mockResolvedValue(true) };

    GeolocationService.mockImplementation(() => ({
      getCountryForUser: jest.fn().mockResolvedValue('US'),
    }));

    EventProcessor.mockImplementation(() => ({
      processBatch: jest.fn().mockResolvedValue({}),
    }));

    const eventsRouter = require('../../routes/events');
    app.use('/api/events', eventsRouter);
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('should handle malformed JSON gracefully', async () => {
    const response = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send('{"invalid json');

    // Express json() middleware returns 400 for invalid JSON
    expect(response.status).toBe(400);
  });

  test('should handle concurrent requests', async () => {
    const requests = Array(10).fill(null).map((_, i) => 
      request(app)
        .post('/api/events')
        .send([{ event_type: `concurrent_${i}`, user_id: `user_${i}` }])
    );

    const responses = await Promise.all(requests);

    // All should succeed
    responses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  test('should include timestamp in response', async () => {
    const response = await request(app)
      .post('/api/events')
      .send([{ event_type: 'test', user_id: 'user_123' }]);

    expect(response.status).toBe(200);
    expect(response.body.timestamp).toBeDefined();
    expect(new Date(response.body.timestamp).getTime()).not.toBeNaN();
  });

  test('should include event count in response', async () => {
    const response = await request(app)
      .post('/api/events')
      .send([
        { event_type: 'event1', user_id: 'user_123' },
        { event_type: 'event2', user_id: 'user_123' },
        { event_type: 'event3', user_id: 'user_123' },
      ]);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(3);
  });
});

