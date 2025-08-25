/**
 * 📊 Monitoring and Metrics Service
 * Comprehensive monitoring for performance, health, and analytics
 */

const os = require('os');
const { performance } = require('perf_hooks');

class MonitoringService {
  constructor(db, redis = null) {
    this.db = db;
    this.redis = redis;
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
        responseTimes: []
      },
      database: {
        queries: 0,
        averageQueryTime: 0,
        queryTimes: [],
        connectionPool: {
          total: 0,
          active: 0,
          idle: 0
        }
      },
      websocket: {
        connections: 0,
        messagesReceived: 0,
        messagesSent: 0,
        rooms: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        operations: 0
      },
      system: {
        cpuUsage: 0,
        memoryUsage: 0,
        uptime: 0,
        loadAverage: []
      },
      leaderboard: {
        scoresSubmitted: 0,
        antiCheatViolations: 0,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
    
    this.startTime = Date.now();
    this.intervals = [];
    
    this.initialize();
  }

  /**
   * Initialize monitoring service
   */
  initialize() {
    console.log('📊 Initializing Monitoring Service...');
    
    // Start system metrics collection
    this.startSystemMetricsCollection();
    
    // Start database metrics collection
    this.startDatabaseMetricsCollection();
    
    // Start cache metrics collection if Redis is available
    if (this.redis) {
      this.startCacheMetricsCollection();
    }
    
    console.log('📊 ✅ Monitoring Service initialized');
  }

  /**
   * Start collecting system metrics
   */
  startSystemMetricsCollection() {
    const interval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000); // Every 30 seconds
    
    this.intervals.push(interval);
  }

  /**
   * Start collecting database metrics
   */
  startDatabaseMetricsCollection() {
    const interval = setInterval(async () => {
      await this.collectDatabaseMetrics();
    }, 60000); // Every minute
    
    this.intervals.push(interval);
  }

  /**
   * Start collecting cache metrics
   */
  startCacheMetricsCollection() {
    const interval = setInterval(async () => {
      await this.collectCacheMetrics();
    }, 30000); // Every 30 seconds
    
    this.intervals.push(interval);
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    try {
      // CPU usage
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      
      cpus.forEach(cpu => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      
      this.metrics.system.cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
      
      // Memory usage
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      this.metrics.system.memoryUsage = Math.round(((totalMemory - freeMemory) / totalMemory) * 100);
      
      // Uptime
      this.metrics.system.uptime = Math.round((Date.now() - this.startTime) / 1000);
      
      // Load average
      this.metrics.system.loadAverage = os.loadavg();
      
    } catch (error) {
      console.error('📊 ❌ Error collecting system metrics:', error);
    }
  }

  /**
   * Collect database metrics
   */
  async collectDatabaseMetrics() {
    try {
      // Connection pool stats
      this.metrics.database.connectionPool = {
        total: this.db.totalCount || 0,
        active: this.db.totalCount - this.db.idleCount || 0,
        idle: this.db.idleCount || 0
      };
      
      // Database performance stats
      const dbStats = await this.db.query(`
        SELECT 
          (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
          (SELECT COUNT(*) FROM pg_stat_activity) as total_connections,
          (SELECT SUM(calls) FROM pg_stat_user_functions) as function_calls,
          (SELECT SUM(n_tup_ins + n_tup_upd + n_tup_del) FROM pg_stat_user_tables) as total_operations
      `);
      
      if (dbStats.rows.length > 0) {
        const stats = dbStats.rows[0];
        this.metrics.database.activeConnections = parseInt(stats.active_connections) || 0;
        this.metrics.database.totalConnections = parseInt(stats.total_connections) || 0;
        this.metrics.database.totalOperations = parseInt(stats.total_operations) || 0;
      }
      
    } catch (error) {
      console.error('📊 ❌ Error collecting database metrics:', error);
    }
  }

  /**
   * Collect cache metrics
   */
  async collectCacheMetrics() {
    try {
      if (!this.redis) return;
      
      const info = await this.redis.info('stats');
      const lines = info.split('\r\n');
      
      for (const line of lines) {
        if (line.startsWith('keyspace_hits:')) {
          this.metrics.cache.hits = parseInt(line.split(':')[1]) || 0;
        } else if (line.startsWith('keyspace_misses:')) {
          this.metrics.cache.misses = parseInt(line.split(':')[1]) || 0;
        }
      }
      
      // Calculate hit rate
      const total = this.metrics.cache.hits + this.metrics.cache.misses;
      this.metrics.cache.hitRate = total > 0 ? Math.round((this.metrics.cache.hits / total) * 100) : 0;
      this.metrics.cache.operations = total;
      
    } catch (error) {
      console.error('📊 ❌ Error collecting cache metrics:', error);
    }
  }

  /**
   * Record HTTP request metrics
   */
  recordRequest(responseTime, success = true) {
    this.metrics.requests.total++;
    
    if (success) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }
    
    // Track response times (keep last 100)
    this.metrics.requests.responseTimes.push(responseTime);
    if (this.metrics.requests.responseTimes.length > 100) {
      this.metrics.requests.responseTimes.shift();
    }
    
    // Calculate average response time
    const sum = this.metrics.requests.responseTimes.reduce((a, b) => a + b, 0);
    this.metrics.requests.averageResponseTime = Math.round(sum / this.metrics.requests.responseTimes.length);
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(queryTime) {
    this.metrics.database.queries++;
    
    // Track query times (keep last 100)
    this.metrics.database.queryTimes.push(queryTime);
    if (this.metrics.database.queryTimes.length > 100) {
      this.metrics.database.queryTimes.shift();
    }
    
    // Calculate average query time
    const sum = this.metrics.database.queryTimes.reduce((a, b) => a + b, 0);
    this.metrics.database.averageQueryTime = Math.round(sum / this.metrics.database.queryTimes.length);
  }

  /**
   * Record WebSocket metrics
   */
  recordWebSocketMetrics(connections, messagesReceived, messagesSent, rooms) {
    this.metrics.websocket = {
      connections,
      messagesReceived,
      messagesSent,
      rooms
    };
  }

  /**
   * Record leaderboard metrics
   */
  recordLeaderboardMetrics(type, data = {}) {
    switch (type) {
      case 'score_submitted':
        this.metrics.leaderboard.scoresSubmitted++;
        break;
      case 'anticheat_violation':
        this.metrics.leaderboard.antiCheatViolations++;
        break;
      case 'cache_hit':
        this.metrics.leaderboard.cacheHits++;
        break;
      case 'cache_miss':
        this.metrics.leaderboard.cacheMisses++;
        break;
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics() {
    return {
      ...this.metrics,
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - this.startTime) / 1000)
    };
  }

  /**
   * Get detailed performance report
   */
  async getPerformanceReport() {
    try {
      const metrics = this.getMetrics();
      
      // Database performance analysis
      const dbPerformance = await this.analyzeDatabasePerformance();
      
      // System health analysis
      const systemHealth = this.analyzeSystemHealth();
      
      // Cache performance analysis
      const cachePerformance = this.analyzeCachePerformance();
      
      return {
        summary: {
          status: this.getOverallHealthStatus(),
          uptime: metrics.uptime,
          timestamp: metrics.timestamp
        },
        performance: {
          requests: {
            total: metrics.requests.total,
            successRate: metrics.requests.total > 0 ? 
              Math.round((metrics.requests.successful / metrics.requests.total) * 100) : 0,
            averageResponseTime: metrics.requests.averageResponseTime,
            requestsPerSecond: metrics.uptime > 0 ? 
              Math.round(metrics.requests.total / metrics.uptime) : 0
          },
          database: dbPerformance,
          cache: cachePerformance,
          system: systemHealth
        },
        leaderboard: {
          scoresSubmitted: metrics.leaderboard.scoresSubmitted,
          antiCheatViolations: metrics.leaderboard.antiCheatViolations,
          antiCheatRate: metrics.leaderboard.scoresSubmitted > 0 ?
            Math.round((metrics.leaderboard.antiCheatViolations / metrics.leaderboard.scoresSubmitted) * 100) : 0,
          cacheHitRate: (metrics.leaderboard.cacheHits + metrics.leaderboard.cacheMisses) > 0 ?
            Math.round((metrics.leaderboard.cacheHits / (metrics.leaderboard.cacheHits + metrics.leaderboard.cacheMisses)) * 100) : 0
        },
        websocket: metrics.websocket
      };
    } catch (error) {
      console.error('📊 ❌ Error generating performance report:', error);
      return {
        error: 'Failed to generate performance report',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Analyze database performance
   */
  async analyzeDatabasePerformance() {
    try {
      const slowQueries = await this.db.query(`
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          rows
        FROM pg_stat_statements 
        WHERE mean_time > 100
        ORDER BY mean_time DESC 
        LIMIT 10
      `);
      
      return {
        queries: this.metrics.database.queries,
        averageQueryTime: this.metrics.database.averageQueryTime,
        connectionPool: this.metrics.database.connectionPool,
        slowQueries: slowQueries.rows || [],
        status: this.metrics.database.averageQueryTime < 50 ? 'good' : 
                this.metrics.database.averageQueryTime < 200 ? 'warning' : 'critical'
      };
    } catch (error) {
      return {
        queries: this.metrics.database.queries,
        averageQueryTime: this.metrics.database.averageQueryTime,
        connectionPool: this.metrics.database.connectionPool,
        slowQueries: [],
        status: 'unknown',
        error: error.message
      };
    }
  }

  /**
   * Analyze system health
   */
  analyzeSystemHealth() {
    const { cpuUsage, memoryUsage, loadAverage } = this.metrics.system;
    
    let status = 'good';
    const warnings = [];
    
    if (cpuUsage > 80) {
      status = 'critical';
      warnings.push('High CPU usage');
    } else if (cpuUsage > 60) {
      status = 'warning';
      warnings.push('Elevated CPU usage');
    }
    
    if (memoryUsage > 90) {
      status = 'critical';
      warnings.push('High memory usage');
    } else if (memoryUsage > 75) {
      status = status === 'good' ? 'warning' : status;
      warnings.push('Elevated memory usage');
    }
    
    if (loadAverage[0] > os.cpus().length * 2) {
      status = 'critical';
      warnings.push('High system load');
    }
    
    return {
      cpuUsage,
      memoryUsage,
      loadAverage,
      status,
      warnings
    };
  }

  /**
   * Analyze cache performance
   */
  analyzeCachePerformance() {
    const { hits, misses, hitRate, operations } = this.metrics.cache;
    
    let status = 'good';
    if (hitRate < 50) {
      status = 'warning';
    } else if (hitRate < 30) {
      status = 'critical';
    }
    
    return {
      hits,
      misses,
      hitRate,
      operations,
      status,
      available: !!this.redis
    };
  }

  /**
   * Get overall health status
   */
  getOverallHealthStatus() {
    const systemHealth = this.analyzeSystemHealth();
    const cacheHealth = this.analyzeCachePerformance();
    
    if (systemHealth.status === 'critical' || cacheHealth.status === 'critical') {
      return 'critical';
    } else if (systemHealth.status === 'warning' || cacheHealth.status === 'warning') {
      return 'warning';
    } else {
      return 'healthy';
    }
  }

  /**
   * Get alerts for critical issues
   */
  getAlerts() {
    const alerts = [];
    const systemHealth = this.analyzeSystemHealth();
    
    // System alerts
    if (systemHealth.status === 'critical') {
      alerts.push({
        type: 'system',
        level: 'critical',
        message: `System critical: ${systemHealth.warnings.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Database alerts
    if (this.metrics.database.averageQueryTime > 500) {
      alerts.push({
        type: 'database',
        level: 'critical',
        message: `Database performance critical: ${this.metrics.database.averageQueryTime}ms average query time`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Cache alerts
    if (this.redis && this.metrics.cache.hitRate < 30) {
      alerts.push({
        type: 'cache',
        level: 'warning',
        message: `Low cache hit rate: ${this.metrics.cache.hitRate}%`,
        timestamp: new Date().toISOString()
      });
    }
    
    return alerts;
  }

  /**
   * Shutdown monitoring service
   */
  shutdown() {
    console.log('📊 🛑 Shutting down Monitoring Service...');
    
    // Clear all intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    console.log('📊 ✅ Monitoring Service shutdown complete');
  }
}

module.exports = { MonitoringService };
