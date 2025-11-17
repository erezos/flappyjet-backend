# Dashboard Not Working - Root Cause Analysis

## 🔍 Issue

Dashboard at https://flappyjet-backend-production.up.railway.app/dashboard.html shows:
- DAU: 18 (shows data!)
- Total Players: 21 (shows data!)
- Games Played: **0** (no data)
- Avg Session: 4m 8s (shows data!)
- All other metrics: **empty**

## 🎯 Root Cause

**The dashboard queries are targeting the WRONG table!**

### **Problem 1: Table Mismatch**

**Dashboard code (`analytics-dashboard.js` line 76):**
```javascript
FROM analytics_events  // ❌ WRONG TABLE
WHERE created_at >= CURRENT_DATE
```

**Actual table structure:**
```sql
-- Events are stored in the "events" table:
CREATE TABLE events (
  id UUID,
  event_type VARCHAR(50),
  user_id VARCHAR(255),
  payload JSONB,
  received_at TIMESTAMP,
  ...
);
```

### **Problem 2: Field Name Mismatches**

**Dashboard queries use:**
- `analytics_events` table → Should be `events`
- `player_id` field → Should be `user_id`
- `created_at` field → Should be `received_at`
- `event_name` field → Should be `event_type`
- `parameters` field → Should be `payload`

---

## 📊 Why Some Data Shows

**Working metrics:**
- **DAU (18)** - Uses `COUNT(DISTINCT user_id) FROM events` ✅
- **Total Players (21)** - Uses `COUNT(DISTINCT user_id) FROM events` ✅  
- **Avg Session (4m 8s)** - Uses `events` table with JSONB `payload` ✅

**Broken metrics:**
- **Games Played** - Queries `analytics_events` table ❌
- **Ad Performance** - Queries `analytics_events` table ❌
- **Level Completion** - Queries `analytics_events` table ❌
- **All other KPIs** - Query `analytics_events` table ❌

The working metrics use the NEW `dashboard-api.js` routes (which we just fixed), while the broken metrics use the OLD `analytics-dashboard.js` routes (which still reference the wrong table).

---

## 🛠️ Solution

We need to update `analytics-dashboard.js` to query the correct table with correct field names:

### **Changes Needed:**

1. **Table name:** `analytics_events` → `events`
2. **Field names:**
   - `player_id` → `user_id`
   - `created_at` → `received_at`
   - `event_name` → `event_type`
   - `parameters` → `payload`

3. **Update all queries** in `/railway-backend/routes/analytics-dashboard.js`

---

## 📝 Example Fix

### **Before (WRONG):**
```sql
SELECT 
  COUNT(DISTINCT player_id) as dau,
  COUNT(*) FILTER (WHERE event_name = 'game_over') as games_played
FROM analytics_events
WHERE created_at >= CURRENT_DATE
```

### **After (CORRECT):**
```sql
SELECT 
  COUNT(DISTINCT user_id) as dau,
  COUNT(*) FILTER (WHERE event_type = 'game_ended') as games_played
FROM events
WHERE received_at >= CURRENT_DATE
```

---

## 🚀 Action Required

Fix the `analytics-dashboard.js` file to use the correct table and field names.

**Affected File:**
- `/Users/erezk/Projects/FlappyJet/railway-backend/routes/analytics-dashboard.js`

**Lines to Fix:**
- Line 76: `FROM analytics_events` → `FROM events`
- Line 43: `player_id` → `user_id`
- Line 77: `created_at` → `received_at`
- Line 46: `event_name` → `event_type`
- Line 50-53: `parameters->>'...'` → `payload->>'...'`
- And all similar occurrences throughout the file

---

## ⚠️ Why This Happened

1. **Two Database Schemas:**
   - Old schema: `analytics_events` table (deprecated)
   - New schema: `events` table (current, from migration 001)

2. **Two Dashboard APIs:**
   - Old: `analytics-dashboard.js` (still uses old table)
   - New: `dashboard-api.js` (uses correct table)

3. **Dashboard HTML confusion:**
   - Calls `/api/analytics/dashboard/kpis` (old API)
   - Should call `/api/dashboard/overview` (new API)

---

## ✅ Recommended Fix Strategy

**Option A: Update analytics-dashboard.js (Quick Fix)**
- Change all table/field references
- Keep existing API structure
- Dashboard HTML works as-is

**Option B: Update Dashboard HTML to use new API (Better)**
- Change HTML to call `/api/dashboard/*` endpoints
- Remove `analytics-dashboard.js` entirely
- Cleaner, uses the API we just fixed

**Option C: Both (Best)**
- Fix `analytics-dashboard.js` for backward compatibility
- Update dashboard HTML to use new API
- Deprecate old API in next version

---

## 📌 Next Steps

1. Decide on fix strategy (A, B, or C)
2. Apply the fix
3. Test dashboard locally
4. Deploy to Railway
5. Verify all metrics show data

---

**Status:** 🔴 Dashboard partially broken due to table/field mismatches  
**Impact:** 🟡 Medium - Basic metrics work, detailed analytics broken  
**Fix Time:** ~15-30 minutes

