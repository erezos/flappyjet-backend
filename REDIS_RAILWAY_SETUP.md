# Redis Setup on Railway - Diagnostic Guide

## 🔍 Current Issue
Based on the deployment logs, Redis is NOT connecting because:
1. No Redis initialization logs appearing
2. Tournament manager failing (null reference)
3. Cache manager running in no-op mode

## 📊 Expected Logs vs Actual Logs

### ✅ What We SHOULD See (if Redis is working):
```
💾 Redis URL found, initializing client...
💾 🔌 Redis connection initiated...
💾 ✅ Redis connected and READY!
💾 ✅ Redis client initialized and ready
💾 ✅ Cache Manager initialized (with Redis)
```

### ❌ What We're Actually Seeing:
```
(NO Redis logs at all - missing from deployment output)
🏆 ❌ Error getting current tournament (null reference)
```

## 🔧 Root Cause
**Railway Redis service is added, but environment variable is NOT being injected into the backend service.**

## ✅ Solution Steps

### Step 1: Verify Redis Service Connection in Railway

1. Go to Railway Dashboard: https://railway.app/project/[your-project]
2. Click on **Redis** service
3. Click on **Variables** tab
4. Look for `REDIS_URL` or `REDIS_PRIVATE_URL`
5. **COPY the value** (format: `redis://default:password@redis.railway.internal:6379`)

### Step 2: Link Redis to Backend Service

**Option A: Automatic Linking (Recommended)**
1. Go to your **flappyjet-backend** service
2. Click **Settings** → **Service Variables**
3. Click **+ New Variable** → **Reference Variable**
4. Select **Redis Service** → **REDIS_URL**
5. This will automatically inject `${{Redis.REDIS_URL}}` into your backend

**Option B: Manual Environment Variable**
1. Go to your **flappyjet-backend** service
2. Click **Variables** tab
3. Add new variable:
   - Name: `REDIS_URL`
   - Value: `redis://default:[password]@redis.railway.internal:6379`
   - (Get this from Redis service variables)

### Step 3: Redeploy Backend
Railway will auto-redeploy when you add the variable. Watch the logs for:
```
💾 Redis URL found, initializing client...
💾 ✅ Redis connected and READY!
```

### Step 4: Verify Services Status
Check the startup logs for the status report:
```
🔧 Services Status:
   💾 Redis: ✅ Connected
   💾 Cache: ✅ Active
   🏆 Tournaments: ✅ Active
   📅 Scheduler: ✅ Active
```

## 🧪 Testing Redis Connection

Once deployed, test the dashboard (uses caching):
```bash
curl https://flappyjet-backend-production.up.railway.app/api/dashboard/overview
```

First call should log:
```
📊 Cache MISS: dashboard-overview - querying database
```

Second call (within 5 minutes) should log:
```
📊 Cache HIT: dashboard-overview
```

## 🚨 Common Issues

### Issue 1: `ENOTFOUND redis.railway.internal`
**Cause**: Redis URL not properly set or Redis service not linked
**Fix**: Follow Step 2 above to properly link services

### Issue 2: `Connection timeout`
**Cause**: Redis service is starting or restarting
**Fix**: Wait 30 seconds and check logs again

### Issue 3: `No Redis URL configured`
**Cause**: Environment variable name mismatch
**Fix**: Backend expects either `REDIS_URL` or `REDIS_PRIVATE_URL`

## 📋 Quick Checklist

- [ ] Redis service exists in Railway project
- [ ] Redis service is running (not crashed)
- [ ] `REDIS_URL` or `REDIS_PRIVATE_URL` visible in Redis service variables
- [ ] Variable is referenced/linked in flappyjet-backend service
- [ ] Backend redeployed after adding variable
- [ ] Logs show "💾 ✅ Redis connected and READY!"
- [ ] Dashboard API responds successfully
- [ ] Cache HIT appears on second dashboard call

## 🎯 Next Steps After Redis is Working

1. Fix tournament manager null checks (safety)
2. Remove unused auth routes (login, register, profile)
3. Test all dashboard endpoints
4. Monitor Redis memory usage
5. Optimize cache TTLs based on usage patterns

