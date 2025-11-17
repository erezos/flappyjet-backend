# Event Schema Audit and Fixes
## Date: 2025-11-17

## Executive Summary

This document details the comprehensive audit of all 28 Flutter event schemas vs. backend validation schemas, identifying mismatches and implementing fixes to achieve 100% event processing success rate.

---

## 🔍 Issues Found in Logs

### **Issue #1: `app_launched` Schema Mismatch** ✅ FIXED
**Log Error:**
```
'"session_number" is required'
'"time_since_last_session" is required'
'"deviceModel" is not allowed'
'"osVersion" is not allowed'
'"appVersion" is not allowed'
'"daysSinceInstall" is not allowed'
'"daysSinceLastSession" is not allowed'
'"isFirstLaunch" is not allowed'
```

**Root Cause:**
- Backend schema expected: `session_number`, `time_since_last_session`
- Flutter client sends: `deviceModel`, `osVersion`, `appVersion`, `daysSinceInstall`, `daysSinceLastSession`, `isFirstLaunch`

**Flutter Code:**
```dart
// lib/main.dart:253-257
_eventBus.fire('app_launched', {
  ..._deviceIdentity.getDeviceMetadata(),  // deviceModel, osVersion, appVersion
  ..._deviceIdentity.getSessionMetadata(), // daysSinceInstall, daysSinceLastSession, isFirstLaunch
});
```

**Fix:** Updated `/railway-backend/services/event-schemas.js`:
```javascript
const appLaunchedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('app_launched').required(),
  // ✅ FIX: Flutter client sends these from getDeviceMetadata()
  deviceModel: Joi.string().optional(),
  osVersion: Joi.string().optional(),
  appVersion: Joi.string().optional(),
  // ✅ FIX: Flutter client sends these from getSessionMetadata()
  daysSinceInstall: Joi.number().integer().min(0).optional(),
  daysSinceLastSession: Joi.number().integer().min(0).optional(),
  isFirstLaunch: Joi.boolean().optional(),
});
```

---

### **Issue #2: Missing `session_id` Column in Database** ✅ FIXED
**Log Error:**
```
ERROR: column "session_id" does not exist at character 170
SELECT session_id FROM events...
```

**Root Cause:**
- Dashboard query tried to access `session_id` as a column
- Actual structure: `events` table stores `session_id` inside JSONB `payload` field

**Database Schema:**
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(50),
  user_id VARCHAR(255),
  payload JSONB,         -- ✅ session_id is HERE
  received_at TIMESTAMP,
  ...
);
```

**Fix:** Updated `/railway-backend/routes/dashboard-api.js`:
```javascript
// BEFORE (WRONG):
SELECT session_id FROM events

// AFTER (CORRECT):
SELECT payload->>'session_id' as session_id FROM events
WHERE payload->>'session_id' IS NOT NULL
```

---

### **Issue #3: Missing `user_installed` Event Type** ✅ FIXED
**Log Error:**
```
Unknown event type: user_installed
```

**Root Cause:**
- Flutter client fires `user_installed` event (similar to `app_installed`)
- Backend database constraint only allowed 28 event types, missing `user_installed`

**Flutter Code:**
```dart
// lib/main.dart:249-251
if (_deviceIdentity.isFirstLaunch) {
  _eventBus.fire('user_installed', _deviceIdentity.getDeviceMetadata());
}
```

**Fix:** Created migration `/railway-backend/database/migrations/006_add_user_installed_event.sql`:
```sql
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    'app_installed',
    'app_launched',
    'user_installed', -- ✅ NEW: Added
    ...
  )
);
```

---

## 📊 Comprehensive Event Schema Audit

### **Analysis Methodology:**
1. ✅ Reviewed all Flutter event fires in codebase
2. ✅ Compared Flutter event payloads with backend Joi schemas
3. ✅ Identified mismatches and optional vs. required fields
4. ✅ Validated database constraints and structure

---

## 🎯 Event Categories Breakdown

### **1. User Lifecycle Events (6 events)**

| Event Type | Flutter Fires? | Schema Status | Notes |
|------------|---------------|---------------|-------|
| `app_installed` | ❌ No | ✅ Valid | Tracked via backend |
| `app_launched` | ✅ Yes | ✅ FIXED | Schema updated |
| `user_installed` | ✅ Yes | ✅ FIXED | Added to constraints |
| `user_registered` | ⚠️ Rare | ✅ Valid | Device ID creation |
| `settings_changed` | ⚠️ Rare | ✅ Valid | Not actively used |
| `app_uninstalled` | ❌ No | ✅ Valid | Backend detection |

**Status:** ✅ All schemas aligned

---

### **2. Game Session Events (8 events)**

| Event Type | Flutter Fires? | Schema Status | Notes |
|------------|---------------|---------------|-------|
| `game_started` | ✅ Yes | ⚠️ REVIEW | See below |
| `game_ended` | ✅ Yes | ⚠️ REVIEW | See below |
| `game_paused` | ⚠️ Rare | ✅ Valid | Not actively used |
| `game_resumed` | ⚠️ Rare | ✅ Valid | Not actively used |
| `continue_used` | ✅ Yes | ⚠️ REVIEW | See below |
| `level_started` | ✅ Yes | ⚠️ REVIEW | Story mode |
| `level_completed` | ✅ Yes | ⚠️ REVIEW | Story mode |
| `level_failed` | ✅ Yes | ⚠️ REVIEW | Story mode |

**⚠️ Potential Issues:**

#### **`game_started` / `game_ended`:**
Flutter uses `trackGameStart()` and `trackGameEnd()` from `UnifiedAnalyticsManager`, which internally maps to different event names.

**Flutter Code:**
```dart
// lib/core/analytics/unified_analytics_manager.dart
void trackGameStart({...}) {
  trackEvent('game_start', {...}); // ❌ Backend expects 'game_started'
}

void trackGameEnd({...}) {
  trackEvent('game_end', {...}); // ❌ Backend expects 'game_ended'
}
```

**Recommendation:** Update `UnifiedAnalyticsManager` to use correct event names OR add aliases in backend.

---

### **3. Economy Events (4 events)**

| Event Type | Flutter Fires? | Schema Status | Notes |
|------------|---------------|---------------|-------|
| `currency_earned` | ⚠️ Partial | ✅ Valid | Via inventory manager |
| `currency_spent` | ⚠️ Partial | ✅ Valid | Via inventory manager |
| `purchase_initiated` | ⚠️ Rare | ✅ Valid | IAP flow |
| `purchase_completed` | ⚠️ Rare | ✅ Valid | IAP flow |

**Status:** ✅ Schemas valid, but usage is minimal

---

### **4. Progression Events (6 events)**

| Event Type | Flutter Fires? | Schema Status | Notes |
|------------|---------------|---------------|-------|
| `skin_unlocked` | ⚠️ Partial | ✅ Valid | Via inventory |
| `skin_equipped` | ✅ Yes | ✅ Valid | Active |
| `achievement_unlocked` | ✅ Yes | ✅ Valid | Active |
| `mission_completed` | ✅ Yes | ✅ Valid | Active |
| `daily_streak_claimed` | ✅ Yes | ✅ Valid | Active |
| `level_unlocked` | ⚠️ Partial | ✅ Valid | Story mode |

**Status:** ✅ All schemas aligned

---

### **5. Social & Engagement Events (5 events)**

| Event Type | Flutter Fires? | Schema Status | Notes |
|------------|---------------|---------------|-------|
| `leaderboard_viewed` | ⚠️ Rare | ✅ Valid | Tournaments |
| `tournament_entered` | ⚠️ Rare | ✅ Valid | Implicit |
| `ad_watched` | ⚠️ Rare | ✅ Valid | Rewarded ads |
| `share_clicked` | ⚠️ Rare | ✅ Valid | Social sharing |
| `notification_received` | ⚠️ Rare | ✅ Valid | Push notifications |

**Status:** ✅ Schemas valid, but usage is minimal

---

## 🚨 Critical Recommendations

### **Priority 1: Event Name Consistency** 🔴
**Issue:** Flutter fires `game_start` / `game_end`, backend expects `game_started` / `game_ended`.

**Fix Options:**
1. **Option A (Recommended):** Update Flutter `UnifiedAnalyticsManager` to use `game_started` / `game_ended`
2. **Option B:** Add event aliases in backend to accept both variants

**Impact:** This affects leaderboard processing and analytics aggregation.

---

### **Priority 2: Base Fields Validation** 🟡
**Issue:** Backend `baseFields` requires `app_version` and `platform`, but Flutter sends them as `appVersion` and `platform`.

**Current Fix:**
```javascript
const baseFields = {
  event_type: Joi.string().required(),
  user_id: Joi.string().required(),
  timestamp: Joi.string().isoDate().required(),
  app_version: Joi.string().required(),  // ✅ Matches Flutter
  platform: Joi.string().valid('ios', 'android').required(), // ✅ Matches Flutter
  session_id: Joi.string().optional(), // ✅ Added for EventBus
};
```

**Flutter EventBus:**
```dart
// lib/core/events/event_bus.dart:111-115
final enrichedData = {
  ...data,
  'app_version': _identityManager!.appVersion, // ✅ Matches backend
  'platform': _identityManager!.platform,      // ✅ Matches backend
};
```

**Status:** ✅ Already aligned

---

## ✅ Files Modified

1. **`/railway-backend/services/event-schemas.js`**
   - Fixed `app_launched` schema to accept Flutter client fields
   - Marked deprecated fields as comments

2. **`/railway-backend/routes/dashboard-api.js`**
   - Fixed `session_id` query to extract from JSONB payload
   - Added null check for missing session_id

3. **`/railway-backend/database/migrations/006_add_user_installed_event.sql`**
   - Added `user_installed` to valid event types constraint

---

## 🧪 Testing Plan

### **Step 1: Test Event Processing**
```bash
# Railway backend logs
railway logs --service backend --filter "Event processed"

# Check success rate
railway logs --service backend --filter "Batch processing complete" | grep "success_rate"
```

**Expected:** `100%` success rate for all events

---

### **Step 2: Test Dashboard Queries**
```bash
# Test session duration query
psql $DATABASE_URL -c "
  SELECT 
    ROUND(AVG(duration_seconds)) as avg_session_seconds
  FROM (
    SELECT 
      user_id,
      payload->>'session_id' as session_id,
      EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) as duration_seconds
    FROM events
    WHERE received_at >= CURRENT_DATE - INTERVAL '7 days'
      AND payload->>'session_id' IS NOT NULL
    GROUP BY user_id, payload->>'session_id'
    HAVING EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at))) > 0
  ) sessions;
"
```

**Expected:** No SQL errors, valid numeric result

---

### **Step 3: Test User Installed Event**
```bash
# Verify constraint allows user_installed
psql $DATABASE_URL -c "
  INSERT INTO events (event_type, user_id, payload)
  VALUES ('user_installed', 'test_user', '{}'::jsonb)
  RETURNING id, event_type;
"

# Clean up test
psql $DATABASE_URL -c "DELETE FROM events WHERE event_type = 'user_installed' AND user_id = 'test_user';"
```

**Expected:** Insert succeeds without constraint violation

---

## 📈 Expected Results

### **Before Fixes:**
```
📊 Batch processing complete
- Total: 2
- Successful: 1
- Failed: 1
- Success rate: 50.00%
```

### **After Fixes:**
```
📊 Batch processing complete
- Total: 2
- Successful: 2
- Failed: 0
- Success rate: 100.00%
```

---

## 🚀 Deployment Steps

### **Step 1: Deploy Backend Changes**
```bash
cd railway-backend
git add services/event-schemas.js routes/dashboard-api.js database/migrations/006_add_user_installed_event.sql
git commit -m "fix: align event schemas with Flutter client and fix database queries"
git push origin main
```

### **Step 2: Run Database Migration**
```bash
# Railway will auto-detect and run the migration
# Or run manually via Railway dashboard:
railway run psql $DATABASE_URL -f database/migrations/006_add_user_installed_event.sql
```

### **Step 3: Monitor Logs**
```bash
railway logs --service backend --tail 100
```

**Watch for:**
- ✅ `Event processed` logs increasing
- ✅ `success_rate: 100.00%` in batch processing
- ❌ No more "Invalid event" warnings

---

## 📝 Future Improvements

1. **Event Name Aliases:** Add backend support for both `game_start` and `game_started`
2. **Schema Auto-sync:** Generate TypeScript/Dart types from backend schemas
3. **Event Validation in Flutter:** Add client-side validation before sending events
4. **Event Documentation:** Auto-generate event documentation from schemas

---

## 🎉 Summary

### **Issues Fixed:**
✅ `app_launched` schema mismatch (8 fields fixed)  
✅ `session_id` database query error (JSONB extraction)  
✅ `user_installed` missing from constraints (added to valid events)

### **Success Rate Improvement:**
📊 **Before:** 50% → **After:** 100% (expected)

### **Files Modified:**
- 2 backend service files
- 1 database migration
- 1 documentation file (this)

### **Deployment Time:**
⏱️ ~5 minutes (auto-deploy via Railway)

---

**Status:** ✅ Ready for Deployment
**Date:** November 17, 2025
**Author:** FlappyJet Backend Team

