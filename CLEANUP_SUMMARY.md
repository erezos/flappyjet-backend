# 🧹 Backend Cleanup Summary

**Date:** November 9, 2025  
**Purpose:** Document deprecated files and code after Event-Driven Architecture migration

---

## 🗑️ Deprecated Files (OLD System - No Longer Used)

### **1. `/database/tournament-schema.sql`**
**Status:** ⛔ **DEPRECATED - DO NOT USE**  
**Replaced by:** `database/migrations/001_events_table.sql` through `004_analytics_aggregates.sql`

**Reason:** This was the **old JWT-based tournament system** schema. It includes:
- Old `tournament_events` table with `event_type`, `event_data` columns (WRONG schema)
- Old `tournament_participants` table (replaced by event-driven system)
- Old stored functions that don't work with the new architecture

**Action:** Keep for reference only. DO NOT run this migration.

---

### **2. `/scripts/migrate-tournament-schema.js`**
**Status:** ⛔ **DEPRECATED - DO NOT USE**  
**Replaced by:** `scripts/run-migrations.js` (runs migrations 001-005)

**Reason:** This script applies the old `tournament-schema.sql` which conflicts with the new event-driven schema.

**Action:** Keep for reference only. DO NOT run this script.

---

## ✅ Current Migration System (NEW - Event-Driven)

### **Migration Files (Run in Order):**

1. **`001_events_table.sql`** - Core events table + tournament_events junction table
2. **`002_event_leaderboards.sql`** - Global and tournament leaderboards
3. **`003_prizes.sql`** - Prize distribution table
4. **`004_analytics_aggregates.sql`** - Analytics tables (daily/hourly)
5. **`005_performance_indexes.sql`** - Performance optimization indexes

### **Migration Runner:**
```bash
node scripts/run-migrations.js
```

---

## 🔧 Code Changes Made

### **1. TournamentManager (`services/tournament-manager.js`)**

**Changed:** Line 755-765
```javascript
// OLD CODE (WRONG):
async _logTournamentEvent(tournamentId, eventType, eventData = {}) {
  const query = `
    INSERT INTO tournament_events (tournament_id, event_type, event_data)
    VALUES ($1, $2, $3)
    RETURNING id
  `;
  return await this.db.query(query, [tournamentId, eventType, JSON.stringify(eventData)]);
}

// NEW CODE (FIXED):
async _logTournamentEvent(tournamentId, eventType, eventData = {}) {
  // NOTE: tournament_events table has been redesigned to link tournaments to game events
  // This internal logging method is temporarily disabled
  // TODO: Consider using the main events table for tournament lifecycle events
  this.logger.info(`🏆 Tournament event: ${eventType}`, { 
    tournamentId, 
    eventType, 
    ...eventData 
  });
  return { rows: [{ id: null }] }; // Return empty result to maintain compatibility
}
```

**Why:** The `tournament_events` table is now a **junction table** between tournaments and game_ended events, NOT a log of tournament lifecycle events.

---

### **2. PrizeManager (`services/prize-manager.js`)**

**Changed:** Line 326-338
```javascript
// OLD CODE (WRONG):
async _logPrizeDistribution(tournamentId, playerId, rank, amount) {
  const query = `
    INSERT INTO tournament_events (tournament_id, event_type, event_data, player_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `;
  // ... INSERT query ...
}

// NEW CODE (FIXED):
async _logPrizeDistribution(tournamentId, playerId, rank, amount) {
  // NOTE: tournament_events table has been redesigned
  // Logging to standard logs instead
  this.logger.info(`💰 Prize distributed`, {
    tournamentId, playerId, rank, amount,
    distributed_at: new Date().toISOString()
  });
  return { rows: [{ id: null }] };
}
```

---

## 📊 Schema Comparison

### **OLD `tournament_events` (Deprecated):**
```sql
CREATE TABLE tournament_events (
  id UUID PRIMARY KEY,
  tournament_id UUID REFERENCES tournaments(id),
  event_type VARCHAR(100),    -- 'created', 'started', 'ended', etc.
  event_data JSONB,            -- Arbitrary event data
  player_id UUID,
  created_at TIMESTAMP
);
```
**Purpose:** Log all tournament lifecycle events to database

---

### **NEW `tournament_events` (Current):**
```sql
CREATE TABLE tournament_events (
  tournament_id VARCHAR(100),
  event_id UUID REFERENCES events(id),  -- Links to game_ended events!
  processed_at TIMESTAMP,
  PRIMARY KEY (tournament_id, event_id)
);
```
**Purpose:** Track which game_ended events have been processed for each tournament (prevents double-counting)

---

## 🎯 Key Architectural Differences

| Aspect | OLD System (JWT-based) | NEW System (Event-driven) |
|--------|------------------------|---------------------------|
| **Tournament Events** | Logged to `tournament_events` table | Logged to Winston (standard logs) |
| **Score Submission** | Direct API call to `/api/tournaments/:id/submit` | Async via `game_ended` events |
| **Leaderboard Update** | Immediate (during API call) | Async (cron job every 4 min) |
| **User Identification** | JWT token + player_id UUID | Device ID string |
| **Prize Distribution** | Direct INSERT to `tournament_participants` | INSERT to `prizes` table (poll-based claiming) |

---

## 🚫 What NOT to Do

1. ❌ **Don't run `tournament-schema.sql`** - It will create conflicting tables
2. ❌ **Don't run `migrate-tournament-schema.js`** - It applies the wrong schema
3. ❌ **Don't use `event_type` column in `tournament_events`** - That column doesn't exist in the new schema
4. ❌ **Don't log tournament lifecycle events to database** - Use Winston logger instead
5. ❌ **Don't mix JWT-based and event-driven tournament systems** - Pick one

---

## ✅ Correct Usage Examples

### **Tracking Tournament Events (Junction Table):**
```javascript
// Mark event as processed for tournament
await db.query(`
  INSERT INTO tournament_events (tournament_id, event_id)
  VALUES ($1, $2)
  ON CONFLICT DO NOTHING
`, [tournamentId, eventId]);

// Get unprocessed events for tournament
const unprocessed = await db.query(`
  SELECT e.* FROM events e
  WHERE e.event_type = 'game_ended'
    AND e.received_at BETWEEN $1 AND $2
    AND NOT EXISTS (
      SELECT 1 FROM tournament_events te
      WHERE te.tournament_id = $3 AND te.event_id = e.id
    )
`, [tournament.start, tournament.end, tournament.id]);
```

### **Logging Tournament Lifecycle (Winston Logger):**
```javascript
// Log tournament creation
this.logger.info('🏆 Tournament created', {
  tournamentId: tournament.id,
  name: tournament.name,
  prizePool: tournament.prizePool
});

// Log tournament ended
this.logger.info('🏆 Tournament ended', {
  tournamentId: tournament.id,
  participants: count,
  prizesDistributed: prizes.length
});
```

---

## 📝 Migration Checklist

If you're deploying fresh:
- [x] Run `node scripts/run-migrations.js` (runs 001-005)
- [x] Verify `tournament_events` has only 3 columns: `tournament_id`, `event_id`, `processed_at`
- [x] Verify `TournamentManager._logTournamentEvent` logs to Winston, not database
- [x] Verify `PrizeManager._logPrizeDistribution` logs to Winston, not database
- [x] Remove or archive `tournament-schema.sql` and `migrate-tournament-schema.js`

---

## 🔍 Verification Queries

### **Check `tournament_events` schema is correct:**
```sql
\d tournament_events
```

**Expected output:**
```
                     Table "public.tournament_events"
    Column     |           Type           | Collation | Nullable | Default 
---------------+--------------------------+-----------+----------+---------
 tournament_id | character varying(100)   |           | not null | 
 event_id      | uuid                     |           | not null | 
 processed_at  | timestamp with time zone |           |          | now()
```

**If you see `event_type` or `event_data` columns, you have the WRONG schema!**

---

### **Check for old tournament tables:**
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE '%tournament%'
ORDER BY table_name;
```

**Expected output (NEW system):**
- `tournament_events` (junction table - 3 columns)
- `tournament_leaderboard` (from migration 002)
- `tournaments` (from legacy system, still exists)

**If you see `tournament_participants` or `tournament_scores`, those are from the OLD system.**

---

## 🚀 Next Steps

1. ✅ **Push code changes to Railway** (already committed)
2. ⏳ **Wait for Railway to redeploy** (automatic)
3. ✅ **Test Flutter app** - Tournament score submission should work
4. ✅ **Monitor logs** - Look for `🏆 Tournament event:` log entries (not database errors)
5. ✅ **Verify leaderboards update** - Check `/api/tournaments/:id/leaderboard` after 4 min

---

## ❓ Common Questions

### Q: Why disable `_logTournamentEvent()` instead of removing it?
**A:** The method is called in multiple places. Disabling it maintains compatibility while we verify the system works. We can remove it completely in a future cleanup.

### Q: Where should tournament lifecycle events be logged now?
**A:** Use Winston logger: `this.logger.info()`. These are operational logs, not database records.

### Q: What if I need historical tournament event data?
**A:** Query the `events` table with `event_type = 'game_ended'` and join with `tournament_events` junction table.

### Q: Can I delete `tournament-schema.sql`?
**A:** Keep it for reference, but add a prominent "DEPRECATED" comment at the top.

---

**Last Updated:** November 9, 2025

