# Migration 025 - Step by Step Instructions

## ⚠️ IMPORTANT: Copy SQL from FILES, not from terminal output!

The terminal output shows corrupted SQL. Always copy from the actual `.sql` files.

---

## Step 1: Complete Recovery (if not done)

First, finish the recovery script. In Railway PostgreSQL CLI, run:

```sql
-- Complete the recovery script (it was cut off)
DO $$
BEGIN
  RAISE NOTICE '✅ Cleanup completed. You can now retry migration 025.';
END $$;
```

Then run the full recovery:

```sql
-- Step 1: Restore events table from backup
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events_backup') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
      RAISE NOTICE 'Dropping existing events table...';
      DROP TABLE IF EXISTS events CASCADE;
    END IF;
    ALTER TABLE events_backup RENAME TO events;
    RAISE NOTICE '✅ Restored events table from events_backup';
  ELSE
    RAISE NOTICE '⚠️ events_backup does not exist';
  END IF;
END $$;

-- Step 2: Clean up partial migration artifacts
DROP TABLE IF EXISTS events_partitioned CASCADE;
DROP FUNCTION IF EXISTS get_weekly_partition_name(DATE) CASCADE;
DROP FUNCTION IF EXISTS create_weekly_partition(DATE) CASCADE;
DROP FUNCTION IF EXISTS maintain_weekly_partitions() CASCADE;

DO $$
BEGIN
  RAISE NOTICE '✅ Cleanup completed. You can now retry migration 025.';
END $$;
```

---

## Step 2: Run Migration 025

**CRITICAL**: Copy the ENTIRE content from the file:
`railway-backend/database/migrations/025_partition_events_table_weekly.sql`

**DO NOT** copy from terminal output - it's corrupted!

### Key Corrections in the File (vs corrupted terminal output):

1. ✅ Line 24: `created_at` (NOT `crted_at`)
2. ✅ Line 40: `CHECK (LENGTH(user_id) > 0)` (NOT `CHECK(user_id) > 0)`)
3. ✅ Line 99: `idx_events_partitioned_type` (NOT `idx_events_partitiod_type`)
4. ✅ Line 246: `RAISE EXCEPTION` (NOT `RAISE EXCTION`)

---

## Step 3: Verify Success

After running migration 025, you should see:
```
✅ Migration 025_partition_events_table_weekly.sql completed successfully
📊 Events table is now partitioned by week
```

If you see errors, check that you copied from the FILE, not from terminal output.

---

## Step 4: Proceed to Migration 026

Only after migration 025 completes successfully, proceed to migration 026.

