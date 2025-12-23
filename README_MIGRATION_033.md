# Migration 033 - Execution Guide

## 🎯 Problem Summary

**Root Cause:**
1. Railway CLI's `\i` command looks for files on Railway **server filesystem**, not your **local filesystem**
2. Copy/pasting SQL into terminal causes **string truncation** (terminal encoding issue)
3. The migration file on disk is **100% correct** - the issue is execution method

## ✅ Solution: Use Local psql with Railway DATABASE_URL

### Step 1: Get DATABASE_URL

**From Railway Dashboard:**
1. Go to https://railway.app
2. Select your project → Postgres service
3. Go to **Variables** tab
4. Copy `DATABASE_URL` or `POSTGRES_URL`

**Or from Railway CLI:**
```bash
railway variables | grep -i postgres
```

### Step 2: Execute Migration

```bash
cd /Users/erezk/Projects/FlappyJet/railway-backend

# Replace YOUR_DATABASE_URL with actual connection string
DATABASE_URL="YOUR_DATABASE_URL" ./QUICK_FIX_MIGRATION_033.sh
```

**Or manually:**
```bash
psql "YOUR_DATABASE_URL" -f database/migrations/033_part3_add_constraint.sql
```

### Step 3: Verify

```sql
SELECT conname FROM pg_constraint 
WHERE conname = 'valid_event_type' 
AND conrelid = 'events'::regclass;
```

Should return: `valid_event_type`

---

## Why This Works

✅ **Uses local psql** - No server filesystem issues  
✅ **Reads local file** - No path resolution problems  
✅ **No copy/paste** - File read directly, no truncation  
✅ **Standard practice** - Industry best practice for migrations  

---

## Migration Files

- `033_part1_drop_constraint.sql` - Drop existing constraint
- `033_part2_check_invalid_events.sql` - Check for invalid event types
- `033_part3_add_constraint.sql` - Add constraint with new events

**Run in order:** Part 1 → Part 2 (verify) → Part 3

