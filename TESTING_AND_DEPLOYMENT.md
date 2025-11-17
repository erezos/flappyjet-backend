# Backend Fixes - Testing and Deployment Summary

## 🎯 Quick Summary

**Fixed 3 critical backend issues causing 50% event processing failure:**

1. ✅ **`app_launched` schema mismatch** - Backend expected wrong fields
2. ✅ **Missing `session_id` column** - Dashboard query error  
3. ✅ **`user_installed` event type missing** - Database constraint error

**Expected Result:** 50% → 100% event processing success rate

---

## 📋 Changes Made

### **1. Event Schema Fix** (`services/event-schemas.js`)
```javascript
// BEFORE: Backend expected fields Flutter doesn't send
const appLaunchedSchema = Joi.object({
  session_number: Joi.number().integer().min(1).required(), // ❌ Flutter doesn't send
  time_since_last_session: Joi.number().integer().min(0).required(), // ❌ Flutter doesn't send
});

// AFTER: Accept fields Flutter actually sends
const appLaunchedSchema = Joi.object({
  deviceModel: Joi.string().optional(), // ✅ Flutter sends
  osVersion: Joi.string().optional(), // ✅ Flutter sends
  appVersion: Joi.string().optional(), // ✅ Flutter sends
  daysSinceInstall: Joi.number().integer().min(0).optional(), // ✅ Flutter sends
  daysSinceLastSession: Joi.number().integer().min(0).optional(), // ✅ Flutter sends
  isFirstLaunch: Joi.boolean().optional(), // ✅ Flutter sends
});
```

---

### **2. Dashboard Query Fix** (`routes/dashboard-api.js`)
```javascript
// BEFORE: Tried to access session_id as column
SELECT session_id FROM events // ❌ Column doesn't exist

// AFTER: Extract from JSONB payload
SELECT payload->>'session_id' as session_id FROM events
WHERE payload->>'session_id' IS NOT NULL // ✅ Correct
```

---

### **3. Database Constraint Fix** (`database/migrations/006_add_user_installed_event.sql`)
```sql
-- Added 'user_installed' to valid event types
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (
  event_type IN (
    'app_installed',
    'app_launched',
    'user_installed', -- ✅ NEW: Added
    ...28 other event types
  )
);
```

---

## 🧪 How to Test

### **Option 1: Watch Railway Logs (Easiest)**
```bash
# In your terminal
cd /Users/erezk/Projects/FlappyJet/railway-backend

# Deploy changes
git add .
git commit -m "fix: align event schemas with Flutter client"
git push origin main

# Watch logs for success
railway logs --tail 100
```

**Look for:**
```
✅ Event processed (should increase)
📊 Batch processing complete - success_rate: 100.00% (should be 100%, not 50%)
❌ Invalid event (should disappear)
```

---

### **Option 2: Test Database Migration (Manual)**
```bash
# Connect to Railway database
railway run psql $DATABASE_URL

# Run migration
\i database/migrations/006_add_user_installed_event.sql

# Test insert
INSERT INTO events (event_type, user_id, payload)
VALUES ('user_installed', 'test_user', '{}'::jsonb)
RETURNING id, event_type;

# Clean up
DELETE FROM events WHERE event_type = 'user_installed' AND user_id = 'test_user';

# Exit
\q
```

---

### **Option 3: Test Dashboard Query (Manual)**
```bash
# Connect to database
railway run psql $DATABASE_URL

# Test session duration query (should not error)
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

# Exit
\q
```

---

## 📊 Expected Results

### **Before Fixes (Current Logs):**
```
{
  errors: [
    '"session_number" is required',
    '"time_since_last_session" is required',
    '"deviceModel" is not allowed',
    '"osVersion" is not allowed',
    ...
  ],
  message: '❌ Invalid event',
  event_type: 'app_launched',
}

{
  total: 2,
  successful: 1,
  failed: 1,
  success_rate: '50.00%', // ❌ BAD
}

ERROR: column "session_id" does not exist // ❌ BAD
```

---

### **After Fixes (Expected):**
```
{
  event_id: 'a2c19660-8d05-4e2b-9bd5-408a96152c27',
  event_type: 'app_launched',
  user_id: 'user_UP1A.231005.007_1763206818788',
  message: '✅ Event processed', // ✅ GOOD
}

{
  total: 2,
  successful: 2,
  failed: 0,
  success_rate: '100.00%', // ✅ GOOD
}

// No SQL errors from dashboard queries
```

---

## 🚀 Deployment Commands

```bash
cd /Users/erezk/Projects/FlappyJet/railway-backend

# Stage changes
git add services/event-schemas.js
git add routes/dashboard-api.js
git add database/migrations/006_add_user_installed_event.sql
git add EVENT_SCHEMA_AUDIT_AND_FIXES.md

# Commit
git commit -m "fix: align event schemas with Flutter client and fix database queries

- Fix app_launched schema to accept Flutter client fields
- Fix dashboard query to extract session_id from JSONB payload
- Add user_installed event type to database constraint
- Comprehensive event schema audit documentation

Expected result: 50% → 100% event processing success rate"

# Push (Railway auto-deploys)
git push origin main

# Monitor deployment
railway logs --tail 100
```

---

## ⏱️ Deployment Timeline

1. **Push changes:** ~10 seconds
2. **Railway build:** ~30 seconds
3. **Railway deploy:** ~30 seconds
4. **Migration runs:** ~5 seconds
5. **Total:** ~1-2 minutes

---

## 🔍 How to Verify Success

### **Check 1: Event Processing Success Rate**
```bash
railway logs --filter "Batch processing complete"
```
**Expected:** `success_rate: 100.00%`

---

### **Check 2: No More Invalid Events**
```bash
railway logs --filter "Invalid event"
```
**Expected:** No recent logs (only old ones from before fix)

---

### **Check 3: Dashboard Loads Without Errors**
```bash
railway logs --filter "session_id"
```
**Expected:** No SQL errors, queries succeed

---

## 📝 Files Modified

| File | Status | Changes |
|------|--------|---------|
| `services/event-schemas.js` | ✅ Modified | Fixed `app_launched` schema (8 fields) |
| `routes/dashboard-api.js` | ✅ Modified | Fixed `session_id` query (JSONB extraction) |
| `database/migrations/006_add_user_installed_event.sql` | ✅ Created | Add `user_installed` to constraints |
| `EVENT_SCHEMA_AUDIT_AND_FIXES.md` | ✅ Created | Comprehensive audit documentation |

---

## 🎯 Next Steps

1. ✅ **Deploy changes** (see commands above)
2. ✅ **Monitor logs** for 100% success rate
3. ⚠️ **Optional:** Test dashboard manually to confirm no errors
4. 🎉 **Celebrate** - No more 50% failure rate!

---

## 💡 Additional Notes

### **Why were events failing?**
- Flutter client sends `deviceModel`, backend expected `session_number`
- Complete mismatch between what Flutter sends and what backend validates

### **Why did dashboard crash?**
- Query tried to access `session_id` column that doesn't exist
- The field is actually inside the JSONB `payload` column

### **Why was user_installed rejected?**
- Database constraint only allowed 28 specific event types
- `user_installed` wasn't in the list (even though Flutter fires it)

---

**Status:** ✅ Ready to Deploy  
**Risk Level:** 🟢 Low (only fixing validation, not changing logic)  
**Rollback:** Easy (just revert commit)  
**Testing:** Watch Railway logs for 5 minutes post-deploy

---

**Questions? Issues?**
- Check Railway logs: `railway logs --tail 100`
- Check database: `railway run psql $DATABASE_URL`
- Rollback: `git revert HEAD && git push`

