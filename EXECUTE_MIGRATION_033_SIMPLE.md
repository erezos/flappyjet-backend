# ✅ SIMPLE SOLUTION: Execute Migration 033

## The Problem
- Railway CLI's `\i` looks for files on server, not your local machine
- Copy/paste truncates strings in terminal
- File on disk is correct, but execution method is wrong

## ✅ The Fix: Use Local psql with Railway DATABASE_URL

### Step 1: Get Your Railway Database URL

**Option A: From Railway Dashboard**
1. Go to Railway dashboard
2. Select your Postgres service
3. Copy the `DATABASE_URL` or `POSTGRES_URL` from Variables tab

**Option B: From Railway CLI** (if linked)
```bash
railway variables
# Look for DATABASE_URL or POSTGRES_URL
```

### Step 2: Run Migration with Local psql

```bash
cd /Users/erezk/Projects/FlappyJet/railway-backend

# Replace YOUR_DATABASE_URL with the actual connection string
psql "YOUR_DATABASE_URL" -f database/migrations/033_part3_add_constraint.sql
```

**Example:**
```bash
psql "postgresql://user:pass@host:port/dbname" -f database/migrations/033_part3_add_constraint.sql
```

### Step 3: Verify Success

```sql
SELECT conname FROM pg_constraint 
WHERE conname = 'valid_event_type' 
AND conrelid = 'events'::regclass;
```

If you see `valid_event_type` returned, migration succeeded! ✅

---

## Alternative: If You're Already in Railway psql Session

**Exit psql first** (`\q`), then:

1. Get the file content locally
2. Copy it (but be careful of truncation)
3. Or use the local psql method above (RECOMMENDED)

---

## Why This Works
- Uses your local psql (no server filesystem issues)
- Reads file from your local filesystem (no path issues)
- No copy/paste truncation (file is read directly)
- Standard PostgreSQL best practice

