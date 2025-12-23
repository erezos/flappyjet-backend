# How to Execute Migration 033

## Problem Analysis
1. **Railway CLI `\i` command**: Looks for files on Railway server filesystem, not your local machine
2. **Copy/paste truncation**: Terminal encoding causes strings to be truncated when pasting
3. **File is correct**: The file on disk has all correct strings

## Solution: Use Correct Path in Railway psql

When you're connected via `railway connect`, you're in the Railway server context.

### Option 1: Use Relative Path (if file is uploaded to Railway)
```sql
\i database/migrations/033_part3_add_constraint.sql
```

### Option 2: Pipe File Content (RECOMMENDED - Works from Local)

**From your local terminal (NOT inside psql):**

```bash
cd /Users/erezk/Projects/FlappyJet/railway-backend
cat database/migrations/033_part3_add_constraint.sql | railway connect --service Postgres
```

### Option 3: Get DATABASE_URL and Use Local psql

```bash
# Get connection string
railway variables | grep DATABASE_URL

# Then use it with local psql
psql $DATABASE_URL -f database/migrations/033_part3_add_constraint.sql
```

## Recommended Approach

**Exit your current psql session** (type `\q` or `Ctrl+D`), then run:

```bash
cd /Users/erezk/Projects/FlappyJet/railway-backend
cat database/migrations/033_part3_add_constraint.sql | railway connect --service Postgres
```

This pipes the file content from your local filesystem into Railway's psql, avoiding both the `\i` path issue and copy/paste truncation.

