# Railway Backend Deployment Guide

## 🎯 Overview

This guide covers deploying the event-driven backend to Railway with PostgreSQL and Redis.

## ✅ Pre-Deployment Checklist

### 1. Code Complete
- [x] Database schema migrations ready
- [x] Event ingestion endpoint implemented
- [x] Event aggregation services implemented
- [x] API endpoints V2 implemented
- [x] Prize calculation service implemented
- [x] Comprehensive tests written (60+ tests)
- [x] All linter warnings fixed

### 2. Database Preparation
- [ ] Backup existing production database
- [ ] Review migration scripts
- [ ] Test migrations on staging database
- [ ] Verify no conflicts with existing tables

### 3. Environment Variables
Required variables in Railway:
```env
# Database (Railway PostgreSQL)
DATABASE_URL=postgresql://...

# Redis (Railway Redis)
REDIS_URL=redis://...

# Application
NODE_ENV=production
PORT=3000

# JWT (existing)
JWT_SECRET=...

# Firebase (existing)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...

# API (existing)
API_VERSION=v1
```

### 4. Railway Services
- [ ] PostgreSQL database provisioned
- [ ] Redis cache provisioned
- [ ] Cron jobs enabled (Railway Pro feature)
- [ ] Persistent volumes configured

## 📦 Deployment Steps

### Step 1: Database Migration

Run migrations to create new tables:

```bash
# Option A: Via Railway CLI
railway run npm run migrate:events

# Option B: Via Railway dashboard (run command)
npm run migrate:events

# Option C: Manually execute SQL files
psql $DATABASE_URL -f database/migrations/001_events_table.sql
psql $DATABASE_URL -f database/migrations/002_event_leaderboards.sql
psql $DATABASE_URL -f database/migrations/003_prizes.sql
psql $DATABASE_URL -f database/migrations/004_analytics_aggregates.sql
```

**Verify migrations:**
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('events', 'leaderboard_global', 'tournament_leaderboard', 'prizes', 'analytics_daily', 'analytics_hourly');

-- Check indexes exist
SELECT indexname FROM pg_indexes WHERE schemaname = 'public';
```

### Step 2: Deploy Code

```bash
# Push to Railway
git add .
git commit -m "feat: event-driven backend with analytics"
git push railway main

# Or use Railway CLI
railway up
```

### Step 3: Verify Deployment

#### Health Check
```bash
curl https://your-railway-app.railway.app/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "websocket": "active"
  }
}
```

#### Test Event Ingestion
```bash
curl -X POST https://your-railway-app.railway.app/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "event_type": "app_launched",
      "user_id": "test_device_123",
      "timestamp": "2025-01-01T00:00:00.000Z"
    }]
  }'
```

Expected response:
```json
{
  "success": true,
  "received": 1
}
```

#### Test Leaderboard V2
```bash
curl https://your-railway-app.railway.app/api/v2/leaderboard/global
```

Expected response:
```json
{
  "success": true,
  "leaderboard": [...],
  "total_players": 1234
}
```

### Step 4: Configure Cron Jobs

Railway Pro includes cron job support. Verify cron jobs are running:

**In `server.js`:**
```javascript
// ✅ Global leaderboard update (every 5 min)
cron.schedule('*/5 * * * *', ...)

// ✅ Tournament leaderboard update (every 2 min)
cron.schedule('*/2 * * * *', ...)

// ✅ Daily KPIs aggregation (every hour)
cron.schedule('0 * * * *', ...)

// ✅ Hourly metrics aggregation (every hour at :30)
cron.schedule('30 * * * *', ...)

// ✅ Old events cleanup (weekly, Sunday 3 AM)
cron.schedule('0 3 * * 0', ...)

// ✅ Prize calculation (Monday 00:05 UTC)
cron.schedule('5 0 * * 1', ...)
```

**Check logs:**
```bash
railway logs | grep "Cron job registered"
```

### Step 5: Monitor Initial Load

Watch logs for 15-30 minutes:

```bash
# Railway CLI
railway logs --tail

# Check for errors
railway logs | grep "ERROR"
railway logs | grep "❌"

# Check for success
railway logs | grep "✅"
```

**Key metrics to watch:**
- Event ingestion rate
- Leaderboard update success
- Database query performance
- Redis cache hit rate
- Memory usage
- CPU usage

## 🔍 Post-Deployment Verification

### 1. Database Verification

```sql
-- Check event ingestion
SELECT COUNT(*) as total_events, 
       COUNT(DISTINCT user_id) as unique_users,
       MIN(received_at) as first_event,
       MAX(received_at) as last_event
FROM events;

-- Check leaderboard population
SELECT COUNT(*) as players, 
       MAX(high_score) as top_score
FROM leaderboard_global;

-- Check tournament leaderboard
SELECT tournament_id, COUNT(*) as participants
FROM tournament_leaderboard
GROUP BY tournament_id;

-- Check pending prizes
SELECT COUNT(*) as pending_prizes,
       SUM(coins) as total_coins,
       SUM(gems) as total_gems
FROM prizes
WHERE claimed_at IS NULL;
```

### 2. API Endpoint Verification

Test all V2 endpoints:

```bash
# Global leaderboard
curl https://your-app.railway.app/api/v2/leaderboard/global

# User rank
curl https://your-app.railway.app/api/v2/leaderboard/user/test_device_123

# Update nickname
curl -X POST https://your-app.railway.app/api/v2/leaderboard/update-nickname \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test_device_123", "nickname": "Test Pilot"}'

# Current tournament
curl https://your-app.railway.app/api/v2/tournaments/current

# Tournament leaderboard
curl https://your-app.railway.app/api/v2/tournaments/weekly_2025_01/leaderboard

# Tournament prizes
curl https://your-app.railway.app/api/v2/tournaments/weekly_2025_01/prizes

# Pending prizes
curl https://your-app.railway.app/api/v2/prizes/pending?user_id=test_device_123

# Claim prize
curl -X POST https://your-app.railway.app/api/v2/prizes/claim \
  -H "Content-Type: application/json" \
  -d '{"prize_id": "test_prize_123", "user_id": "test_device_123"}'
```

### 3. Cron Job Verification

Check logs at scheduled times:

```bash
# Wait for next 5-minute mark (global leaderboard)
railway logs | grep "Global leaderboard"

# Wait for next 2-minute mark (tournament leaderboard)
railway logs | grep "Tournament leaderboard"

# Wait for top of hour (analytics aggregation)
railway logs | grep "Daily KPIs"
```

### 4. Flutter App Integration

Update Flutter app's backend URL:

```dart
// lib/services/backend_config.dart
static const String baseUrl = 'https://your-app.railway.app';
```

Test from Flutter app:
1. ✅ App launch → Event fires
2. ✅ Play game → Event fires
3. ✅ Game ends → Leaderboard updates
4. ✅ View leaderboard → Top 15 with nicknames
5. ✅ View tournaments → Current tournament info
6. ✅ Check prizes → Poll for pending prizes

## 🚨 Rollback Plan

If issues occur:

### Option 1: Revert Code
```bash
git revert HEAD
git push railway main
```

### Option 2: Rollback Database
```bash
# Drop new tables (only if no data loss acceptable)
psql $DATABASE_URL -c "DROP TABLE IF EXISTS events, leaderboard_global, tournament_leaderboard, prizes, analytics_daily, analytics_hourly CASCADE;"
```

### Option 3: Disable Event System
Set environment variable:
```env
DISABLE_EVENT_SYSTEM=true
```

Then update `server.js`:
```javascript
if (process.env.DISABLE_EVENT_SYSTEM !== 'true') {
  app.use('/api/events', eventsRoutes);
  // ... cron jobs
}
```

## 📊 Monitoring

### Railway Dashboard
- CPU usage (should be < 50%)
- Memory usage (should be < 80%)
- Database connections (should be < pool size)
- Request rate (track growth)

### Database Monitoring
```sql
-- Active queries
SELECT * FROM pg_stat_activity WHERE state = 'active';

-- Table sizes
SELECT 
  table_name, 
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;

-- Slow queries
SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;
```

### Redis Monitoring
```bash
redis-cli -u $REDIS_URL INFO stats
redis-cli -u $REDIS_URL INFO memory
```

## 🎉 Success Criteria

Deployment is successful when:

- [x] All migrations applied without errors
- [x] Health check returns 200 OK
- [x] Event ingestion working (POST /api/events returns 200)
- [x] Leaderboards populating (GET /api/v2/leaderboard/global returns data)
- [x] Tournaments visible (GET /api/v2/tournaments/current returns data)
- [x] All cron jobs registered and running
- [x] No critical errors in logs
- [x] Flutter app connects and receives data
- [x] Database performance acceptable (queries < 100ms)
- [x] Redis cache hit rate > 80%

## 🔧 Troubleshooting

### Issue: "Table already exists" during migration
**Solution:** Check if tables exist, drop if empty, or skip migration

### Issue: Event ingestion fails
**Check:**
- Database connection
- Events table exists
- Joi validation errors in logs

### Issue: Leaderboard not updating
**Check:**
- Cron job logs
- `game_ended` events being received
- LeaderboardAggregator errors

### Issue: Prizes not appearing
**Check:**
- Prize calculation cron job (Monday 00:05)
- Tournament winners exist
- Prizes table populated

### Issue: High memory usage
**Solution:**
- Check for memory leaks
- Reduce cron job frequency
- Increase Railway plan

## 📝 Post-Deployment Tasks

1. ✅ Update Flutter app backend URL
2. ✅ Monitor logs for 24 hours
3. ✅ Verify first tournament prize distribution (next Monday)
4. ✅ Set up analytics dashboard queries
5. ✅ Document any issues
6. ✅ Create runbook for on-call

## 📧 Support Contacts

- **Railway Support:** help@railway.app
- **Database Issues:** Check Railway dashboard > PostgreSQL > Logs
- **Redis Issues:** Check Railway dashboard > Redis > Metrics

---

**Deployment Date:** TBD
**Deployed By:** TBD
**Status:** ✅ Ready for deployment
**Rollback Plan:** Documented above

