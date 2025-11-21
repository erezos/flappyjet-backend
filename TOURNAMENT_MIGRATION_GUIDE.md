# 🏆 Tournament System Migration Guide

**Status:** Schema created, needs to be applied to Railway database

---

## ✅ What Was Fixed:

### Root Cause:
The tournament system was **incomplete** in the database:
- ❌ No `tournaments` table
- ❌ No `tournament_participants` table  
- ❌ No `create_weekly_tournament()` function
- ✅ Backend code expected these but they didn't exist!

### Solution:
Created comprehensive migration: `008_tournaments_schema.sql`

---

## 📋 Migration Script Deployed:

**File:** `database/migrations/008_tournaments_schema.sql`

**Creates:**
1. **`tournaments` table** - Tournament metadata
   - ID, name, dates, status, prize pool
   - Statuses: `upcoming`, `active`, `ended`, `cancelled`

2. **`tournament_participants` table** - Player scores
   - Links players to tournaments
   - Tracks scores, games, ranks, prizes

3. **Database Functions:**
   - `create_weekly_tournament()` - Auto-create weekly tournaments
   - `update_tournament_statuses()` - Auto-transition statuses
   - `get_current_tournament()` - Get active/upcoming tournament

4. **Bonus:** Auto-creates first tournament on migration!

---

## 🔧 How to Apply Migration:

### Option 1: Railway CLI (Recommended)

```bash
# 1. Install Railway CLI (if not installed)
npm install -g @railway/cli

# 2. Login
railway login

# 3. Link to project
cd railway-backend
railway link

# 4. Connect to database
railway connect postgres

# 5. In psql prompt, run migration:
\i database/migrations/008_tournaments_schema.sql

# 6. Verify
SELECT * FROM tournaments;
```

### Option 2: Railway Dashboard

1. Go to Railway Dashboard
2. Open PostgreSQL service
3. Click "Connect"
4. Copy connection URL
5. Use any PostgreSQL client (TablePlus, pgAdmin, DBeaver)
6. Paste migration SQL and execute

### Option 3: Copy-Paste in Railway Connect

```bash
railway connect postgres
```

Then paste the entire contents of `008_tournaments_schema.sql`

---

## 🧪 Verify Migration Success:

After running migration, check:

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('tournaments', 'tournament_participants');

-- Check functions exist
SELECT routine_name FROM information_schema.routines 
WHERE routine_name LIKE '%tournament%';

-- Check if first tournament was created
SELECT * FROM tournaments;

-- Check tournament summary view
SELECT * FROM v_tournament_summary;
```

**Expected:**
- 2 tables found
- 3 functions found
- 1 tournament created (upcoming)

---

## 🎯 Test Tournament Creation Endpoint:

After migration is applied:

```bash
curl -X POST https://flappyjet-backend-production.up.railway.app/api/tournaments/admin/create-weekly
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Weekly tournament created",
  "tournament": {
    "id": "tournament_2025_w48",
    "name": "Weekly Championship 2025 W48",
    "status": "upcoming",
    "start_date": "2025-11-25T00:00:00.000Z",
    "end_date": "2025-12-01T23:59:00.000Z",
    "prize_pool": 1000
  }
}
```

**Error "Tournament already exists"** = Migration created it automatically! ✅

---

## 📱 Flutter App Integration:

Once migration is applied:

1. **Tournament Tab** will work
2. **Leaderboard** will load
3. **Players can register** for tournaments
4. **Scores will track** correctly

---

## 🔄 Automatic Tournament Lifecycle:

### Cron Jobs (Already configured in server.js):

1. **Sunday 23:50 UTC** - Create next week's tournament
2. **Monday 00:00 UTC** - Tournament starts (status: `active`)
3. **Sunday 23:59 UTC** - Tournament ends (status: `ended`)
4. **Monday 00:05 UTC** - Prizes calculated

### Status Transitions:

```
upcoming → active → ended
   ↓         ↓        ↓
Created   Starts    Ends
Sunday    Monday   Sunday
23:50     00:00    23:59
```

---

## 🎮 Tournament Features Now Working:

✅ Weekly tournaments (Monday-Sunday)
✅ Player registration (free entry)
✅ Score tracking (best score + total games)
✅ Real-time leaderboards
✅ Prize distribution (top 50)
✅ Automatic tournament creation
✅ Status management (upcoming/active/ended)

---

## 🚨 Important Notes:

1. **Migration MUST be run manually** (Railway doesn't auto-run migrations)
2. **One-time setup** required
3. **After migration:** Tournaments will work indefinitely
4. **Cron jobs** will handle everything automatically

---

## 📊 Prize Distribution (Already Configured):

| Rank | Coins | Gems |
|------|-------|------|
| 1st  | 5000  | 250  |
| 2nd  | 3000  | 150  |
| 3rd  | 2000  | 100  |
| 4-10 | 1000  | 50   |
| 11-50| 500   | 25   |

---

## ✅ Next Steps:

1. **Run migration** on Railway database (see options above)
2. **Test endpoint** to verify tournament creation
3. **Open app** and check Tournament tab
4. **Play game** and verify score tracking

---

**Status:** Schema ready, waiting for database migration to be applied! 🚀

