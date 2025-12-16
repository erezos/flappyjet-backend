# 🚨 Database Connection Pool Timeout Issues - Analysis & Fixes

## 📋 Problem Summary

**Symptoms:**
- Multiple "Query read timeout" errors
- Multiple "timeout exceeded when trying to connect" errors
- All errors occurring at the same timestamp (burst pattern)
- Errors affecting multiple dashboard API endpoints simultaneously

**Affected Endpoints:**
- `/api/dashboard/overview` (top-events-10, rate-us-7days)
- `/api/dashboard/conversions` (conversion analytics)
- `/api/dashboard/achievements` (achievement data)
- `/api/dashboard/dau-trend` (DAU trend)
- `/api/dashboard/purchases` (purchase data)
- `/api/dashboard/tournaments` (tournament analytics)

---

## 🔍 Root Cause Analysis

### 1. **Connection Pool Exhaustion**

**Current Configuration** (`server.js` lines 45-64):
```javascript
max: 50,                    // Max connections
connectionTimeoutMillis: 5000, // 5s to get connection
query_timeout: 10000,        // 10s max per query
statement_timeout: 10000,    // 10s max per statement
```

**Problem:**
- Dashboard API executes **many queries in parallel** using `Promise.all()` (line 109 in `dashboard-api.js`)
- Each dashboard request can spawn 6-10+ concurrent database queries
- If multiple dashboard requests arrive simultaneously, they can exhaust the 50-connection pool
- New queries wait up to 5 seconds for a connection, then timeout with "timeout exceeded when trying to connect"
- Existing queries that take >10 seconds timeout with "Query read timeout"

### 2. **Slow Queries**

**Evidence:**
- Queries timing out at 10 seconds suggests they're taking too long
- Complex aggregations on `events` table (large dataset)
- No query optimization or indexing visible in error logs

**Example Slow Query Pattern** (from `dashboard-api.js`):
```javascript
// Multiple complex queries in Promise.all
const [dauResult, totalPlayersResult, avgSessionResult, ...] = await Promise.all([
  db.query(`SELECT COUNT(DISTINCT user_id) FROM events WHERE received_at >= CURRENT_DATE`),
  db.query(`SELECT COUNT(DISTINCT user_id) FROM events`),
  db.query(`SELECT ROUND(AVG(duration_seconds)) FROM (complex subquery...)`),
  // ... more queries
]);
```

### 3. **Burst Traffic Pattern**

**Evidence:**
- All errors at timestamp `2025-12-16 07:11:25` (same second)
- Suggests dashboard page load or scheduled refresh triggered multiple simultaneous requests
- Each request spawns multiple parallel queries, overwhelming the pool

---

## ✅ Recommended Fixes

### **Fix #1: Increase Connection Pool Size** (Immediate)

**Action:** Increase `max` connections from 50 to 100 (Railway Pro supports 100+)

**File:** `railway-backend/server.js` (line 50)

```javascript
max: 100,  // Increased from 50 to handle concurrent dashboard requests
```

**Rationale:**
- Dashboard requests are bursty (multiple queries per request)
- Railway Pro supports 100+ connections
- This provides headroom for concurrent requests

---

### **Fix #2: Add Query Timeout with Better Error Handling** (Immediate)

**Action:** Wrap all database queries with explicit timeout handling

**File:** `railway-backend/routes/dashboard-api.js`

Add helper function:
```javascript
/**
 * Execute query with timeout and connection pool error handling
 */
async function executeQueryWithTimeout(queryFn, timeoutMs = 8000) {
  return Promise.race([
    queryFn(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    )
  ]).catch(error => {
    // Handle connection pool exhaustion gracefully
    if (error.message.includes('timeout exceeded when trying to connect')) {
      logger.warn('📊 Connection pool exhausted, retrying with delay...');
      // Retry once after short delay
      return new Promise(resolve => {
        setTimeout(() => {
          queryFn().then(resolve).catch(reject => {
            logger.error('📊 Query retry failed:', reject);
            throw new Error('Query failed after retry');
          });
        }, 1000);
      });
    }
    throw error;
  });
}
```

**Update `getCachedQuery` to use it:**
```javascript
async function getCachedQuery(req, cacheKey, queryFn, ttl = CACHE_TTL) {
  try {
    // ... existing cache logic ...
    
    // Cache miss - query database with timeout
    logger.info(`📊 Cache MISS: ${cacheKey} - querying database`);
    const result = await executeQueryWithTimeout(queryFn, 8000); // 8s timeout (below 10s pool limit)
    
    // ... rest of function ...
  } catch (error) {
    // ... existing error handling ...
  }
}
```

---

### **Fix #3: Implement Query Queuing/Throttling** (Short-term)

**Action:** Limit concurrent queries per dashboard request

**File:** `railway-backend/routes/dashboard-api.js`

Replace `Promise.all()` with batched execution:
```javascript
// Instead of:
const [result1, result2, result3, ...] = await Promise.all([...]);

// Use batched execution:
const batchSize = 3; // Max 3 concurrent queries
const results = [];
for (let i = 0; i < queries.length; i += batchSize) {
  const batch = queries.slice(i, i + batchSize);
  const batchResults = await Promise.all(batch.map(q => executeQueryWithTimeout(q)));
  results.push(...batchResults);
}
```

**Rationale:**
- Prevents single dashboard request from consuming all connections
- Allows other requests to get connections
- Still maintains parallelism within batches

---

### **Fix #4: Add Connection Pool Monitoring** (Short-term)

**Action:** Log pool statistics to identify exhaustion patterns

**File:** `railway-backend/server.js`

Add monitoring:
```javascript
// Add after pool creation (line 64)
setInterval(() => {
  if (db) {
    logger.info('🐘 Connection Pool Stats:', {
      totalCount: db.totalCount,
      idleCount: db.idleCount,
      waitingCount: db.waitingCount,
      max: db.options.max
    });
    
    // Warn if pool is >80% utilized
    if (db.totalCount / db.options.max > 0.8) {
      logger.warn('🐘 ⚠️ Connection pool >80% utilized!', {
        utilization: `${Math.round((db.totalCount / db.options.max) * 100)}%`,
        waiting: db.waitingCount
      });
    }
  }
}, 30000); // Every 30 seconds
```

---

### **Fix #5: Optimize Slow Queries** (Medium-term)

**Action:** Add database indexes and optimize query patterns

**Priority Queries to Optimize:**
1. `COUNT(DISTINCT user_id) FROM events` - Add index on `user_id`
2. `WHERE received_at >= CURRENT_DATE` - Add index on `received_at`
3. Complex session duration calculations - Consider materialized views

**File:** Create new migration `railway-backend/database/migrations/008_add_dashboard_indexes.sql`

```sql
-- Index for DAU queries
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type_received_at ON events(event_type, received_at);

-- Composite index for common dashboard queries
CREATE INDEX IF NOT EXISTS idx_events_user_received ON events(user_id, received_at);
```

---

### **Fix #6: Implement Circuit Breaker for Dashboard API** (Medium-term)

**Action:** Prevent cascade failures when database is overwhelmed

**File:** `railway-backend/routes/dashboard-api.js`

Add circuit breaker pattern:
```javascript
let circuitBreakerState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
let failureCount = 0;
const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT = 60000; // 1 minute

function checkCircuitBreaker() {
  if (circuitBreakerState === 'OPEN') {
    throw new Error('Circuit breaker OPEN - dashboard temporarily unavailable');
  }
}

function recordFailure() {
  failureCount++;
  if (failureCount >= FAILURE_THRESHOLD) {
    circuitBreakerState = 'OPEN';
    logger.error('📊 Circuit breaker OPEN - too many failures');
    setTimeout(() => {
      circuitBreakerState = 'HALF_OPEN';
      failureCount = 0;
      logger.info('📊 Circuit breaker HALF_OPEN - testing recovery');
    }, RESET_TIMEOUT);
  }
}

function recordSuccess() {
  if (circuitBreakerState === 'HALF_OPEN') {
    circuitBreakerState = 'CLOSED';
    logger.info('📊 Circuit breaker CLOSED - service recovered');
  }
  failureCount = 0;
}
```

---

## 🚀 Implementation Priority

1. **IMMEDIATE** (Do Now):
   - ✅ Fix #1: Increase pool size to 100
   - ✅ Fix #2: Add query timeout handling

2. **SHORT-TERM** (This Week):
   - ✅ Fix #3: Implement query queuing
   - ✅ Fix #4: Add pool monitoring

3. **MEDIUM-TERM** (Next Sprint):
   - ✅ Fix #5: Optimize queries with indexes
   - ✅ Fix #6: Implement circuit breaker

---

## 📊 Expected Results

**After Immediate Fixes:**
- Connection pool exhaustion should be rare (100 connections vs 50)
- Query timeouts should be handled gracefully with retries
- Dashboard should continue working even under load

**After All Fixes:**
- Dashboard API should handle 10+ concurrent requests without issues
- Query performance improved by 50-80% with indexes
- Circuit breaker prevents cascade failures
- Pool monitoring provides visibility into usage patterns

---

## 🧪 Testing Checklist

After implementing fixes:

1. **Load Test Dashboard:**
   ```bash
   # Simulate 10 concurrent dashboard requests
   for i in {1..10}; do
     curl https://flappyjet-backend-production.up.railway.app/api/dashboard/overview &
   done
   wait
   ```

2. **Monitor Logs:**
   - Check for connection pool warnings
   - Verify query timeouts are handled gracefully
   - Confirm no "timeout exceeded" errors

3. **Check Pool Stats:**
   - Verify pool utilization stays <80%
   - Confirm no waiting connections

---

## 📝 Files to Modify

1. `railway-backend/server.js` - Pool configuration, monitoring
2. `railway-backend/routes/dashboard-api.js` - Query timeout handling, queuing
3. `railway-backend/database/migrations/008_add_dashboard_indexes.sql` - New migration (create)

---

## 🔗 Related Issues

- Redis caching should help reduce database load (if Redis is connected)
- Dashboard views refresh (cron job) might be contributing to load
- Consider implementing dashboard data pre-computation (materialized views)

