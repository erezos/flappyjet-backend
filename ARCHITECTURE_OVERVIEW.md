# 🏗️ FlappyJet Backend Architecture Overview

**Last Updated:** November 9, 2025  
**Version:** 2.0 (Event-Driven)

---

## 📋 Table of Contents
1. [Core Architecture](#core-architecture)
2. [Database Schema](#database-schema)
3. [Event Flow](#event-flow)
4. [Tournament System](#tournament-system)
5. [Key Services](#key-services)
6. [API Endpoints](#api-endpoints)

---

## 🎯 Core Architecture

### **Hybrid Event-Driven System**

FlappyJet uses a **hybrid architecture** combining:
- **Legacy JWT-based endpoints** (old system, still functional)
- **New event-driven system** (device-ID based, future-proof)

Both systems run in parallel without interfering with each other.

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUTTER APP (Client)                      │
│  • Local-first gameplay (100% offline capable)               │
│  • Fires 28 event types to backend (fire-and-forget)        │
│  • Polls for leaderboards/prizes (cached endpoints)         │
└─────────────────────────────────────────────────────────────┘
         ↓ Fire-and-Forget Events    ↑ Background Polling
┌─────────────────────────────────────────────────────────────┐
│                 EXPRESS.JS BACKEND (Railway)                 │
├─────────────────────────────────────────────────────────────┤
│ 1. EVENT INGESTION (Instant)                                │
│    POST /api/events → Store in events table → 200 OK        │
│                                                              │
│ 2. ASYNC PROCESSING (Cron Jobs)                             │
│    • LeaderboardAggregator (every 10 min)                   │
│    • TournamentAggregator (every 4 min)                     │
│    • AnalyticsAggregator (hourly/daily)                     │
│    • PrizeCalculator (weekly)                               │
│                                                              │
│ 3. CACHED ENDPOINTS (5 min cache)                           │
│    GET /api/leaderboard/global → Redis cache → PostgreSQL   │
│    GET /api/tournaments/current → Redis cache → PostgreSQL  │
│    GET /api/prizes/pending → Redis cache → PostgreSQL       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema

### **Core Tables**

#### 1. **`events`** - Raw Event Storage
**Purpose:** Store all 28 event types from Flutter app  
**Processing:** Cron jobs mark as `processed_at` after aggregation

```sql
events {
  id UUID PRIMARY KEY
  event_type VARCHAR(50)  -- One of 28 valid types
  user_id VARCHAR(255)    -- Device ID (not email/username)
  payload JSONB           -- Event data (validated by Joi)
  received_at TIMESTAMP
  processed_at TIMESTAMP  -- NULL = unprocessed
  processing_attempts INT
  processing_error TEXT
}
```

**Key Indexes:**
- `idx_events_type_unprocessed` - For cron jobs to find unprocessed events
- `idx_events_payload` (GIN) - For querying payload fields

---

#### 2. **`tournament_events`** - Tournament Event Tracking
**Purpose:** Track which game events have been processed for each tournament  
**Why:** Prevents double-counting when tournament periods overlap with cron runs

```sql
tournament_events {
  tournament_id VARCHAR(100)
  event_id UUID REFERENCES events(id)
  processed_at TIMESTAMP
  PRIMARY KEY (tournament_id, event_id)
}
```

**⚠️ IMPORTANT:** This is **NOT a log table** for tournament lifecycle events!  
It's a **junction table** between tournaments and game_ended events.

**Example Usage:**
```javascript
// When processing game_ended events for a tournament:
const unprocessedEvents = await db.query(`
  SELECT e.* FROM events e
  WHERE e.event_type = 'game_ended'
    AND e.received_at BETWEEN $1 AND $2
    AND NOT EXISTS (
      SELECT 1 FROM tournament_events te
      WHERE te.tournament_id = $3 AND te.event_id = e.id
    )
`);

// After processing, mark as processed:
await db.query(`
  INSERT INTO tournament_events (tournament_id, event_id)
  VALUES ($1, $2)
`, [tournamentId, eventId]);
```

---

#### 3. **`leaderboard_global`** - Global Leaderboard
**Purpose:** Calculated from `game_ended` events  
**Updated:** Every 10 minutes by `LeaderboardAggregator`

```sql
leaderboard_global {
  user_id VARCHAR(255) PRIMARY KEY
  nickname VARCHAR(50)
  high_score INTEGER
  total_games INTEGER
  last_played_at TIMESTAMP
}
```

---

#### 4. **`tournament_leaderboard`** - Tournament Rankings
**Purpose:** Calculated from `game_ended` events during tournament period  
**Updated:** Every 4 minutes by `TournamentAggregator`

```sql
tournament_leaderboard {
  tournament_id VARCHAR(100)
  user_id VARCHAR(255)
  nickname VARCHAR(50)
  best_score INTEGER
  total_attempts INTEGER
  PRIMARY KEY (tournament_id, user_id)
}
```

---

#### 5. **`prizes`** - Prize Distribution
**Purpose:** Store unclaimed prizes for poll-based claiming  
**Updated:** Weekly by `PrizeCalculator` when tournaments end

```sql
prizes {
  prize_id VARCHAR(255) PRIMARY KEY
  user_id VARCHAR(255)
  tournament_id VARCHAR(100)
  rank INTEGER
  coins INTEGER
  gems INTEGER
  awarded_at TIMESTAMP
  claimed_at TIMESTAMP  -- NULL = unclaimed
}
```

---

#### 6. **`analytics_daily`** / **`analytics_hourly`** - KPI Aggregates
**Purpose:** Pre-calculated metrics for dashboard  
**Updated:** Hourly/daily by `AnalyticsAggregator`

---

## 🔄 Event Flow

### **1. Event Ingestion (Instant)**

```javascript
// POST /api/events
app.post('/api/events', async (req, res) => {
  // 1. Validate events (Joi schemas)
  const validEvents = await EventProcessor.validate(req.body.events);
  
  // 2. Store in database
  await db.query(`
    INSERT INTO events (event_type, user_id, payload)
    VALUES ($1, $2, $3)
  `, [event.event_type, event.user_id, event.payload]);
  
  // 3. Return 200 OK immediately
  res.json({ success: true, received: validEvents.length });
});
```

**⏱️ Response Time:** < 50ms (instant acknowledgment)

---

### **2. Event Processing (Async)**

#### **Leaderboard Aggregator** (Every 10 minutes)
```javascript
cron.schedule('*/10 * * * *', async () => {
  // 1. Get unprocessed game_ended events
  const events = await db.query(`
    SELECT * FROM events
    WHERE event_type = 'game_ended'
      AND processed_at IS NULL
  `);
  
  // 2. Update leaderboard_global
  for (const event of events) {
    await db.query(`
      INSERT INTO leaderboard_global (user_id, high_score, total_games)
      VALUES ($1, $2, 1)
      ON CONFLICT (user_id) DO UPDATE SET
        high_score = GREATEST(leaderboard_global.high_score, EXCLUDED.high_score),
        total_games = leaderboard_global.total_games + 1
    `, [event.user_id, event.payload.score]);
  }
  
  // 3. Mark as processed
  await db.query(`
    UPDATE events SET processed_at = NOW()
    WHERE id = ANY($1)
  `, [eventIds]);
  
  // 4. Clear cache
  await cache.delete('leaderboard:global:*');
});
```

#### **Tournament Aggregator** (Every 4 minutes)
```javascript
cron.schedule('*/4 * * * *', async () => {
  const tournament = await getCurrentTournament();
  
  // 1. Get unprocessed game_ended events for tournament period
  const events = await db.query(`
    SELECT e.* FROM events e
    WHERE e.event_type = 'game_ended'
      AND e.received_at BETWEEN $1 AND $2
      AND NOT EXISTS (
        SELECT 1 FROM tournament_events te
        WHERE te.tournament_id = $3 AND te.event_id = e.id
      )
  `, [tournament.start, tournament.end, tournament.id]);
  
  // 2. Update tournament_leaderboard
  for (const event of events) {
    await db.query(`
      INSERT INTO tournament_leaderboard (tournament_id, user_id, best_score)
      VALUES ($1, $2, $3)
      ON CONFLICT (tournament_id, user_id) DO UPDATE SET
        best_score = GREATEST(tournament_leaderboard.best_score, EXCLUDED.best_score)
    `, [tournament.id, event.user_id, event.payload.score]);
    
    // 3. Mark as processed for THIS tournament
    await db.query(`
      INSERT INTO tournament_events (tournament_id, event_id)
      VALUES ($1, $2)
    `, [tournament.id, event.id]);
  }
  
  // 4. Clear cache
  await cache.delete(`tournament:${tournament.id}:*`);
});
```

---

## 🏆 Tournament System

### **Tournament Lifecycle**

```
1. CREATED (via admin endpoint or cron)
   ↓
2. ACTIVE (players submit scores via game_ended events)
   ↓ (TournamentAggregator runs every 4 min)
   ↓
3. ENDED (manual or cron trigger)
   ↓ (PrizeCalculator runs)
   ↓
4. PRIZES DISTRIBUTED (stored in prizes table)
   ↓
5. PRIZES CLAIMED (Flutter polls /api/prizes/pending)
```

### **Important Notes:**

- **No explicit tournament event logging** - All tracking happens via `tournament_events` junction table
- **No lifecycle events** - Tournament state changes are logged via standard logs, not database
- **Event-driven scoring** - All scores come from `game_ended` events, not direct API calls

---

## 🔧 Key Services

### **EventProcessor**
- Validates incoming events using Joi schemas
- Matches Flutter's 28 event types exactly
- Returns validation errors for debugging

### **LeaderboardAggregator**
- Processes `game_ended` events → Updates `leaderboard_global`
- Runs every 10 minutes
- Clears Redis cache after updates

### **TournamentManager** (New Event-Driven)
- Manages tournament lifecycle
- **No longer logs to `tournament_events`** (that table is for tracking processed events)
- Uses Redis cache for current tournament

### **PrizeCalculator**
- Calculates prize distribution when tournament ends
- Stores in `prizes` table for poll-based claiming
- Logs to standard logs (not database)

---

## 🌐 API Endpoints

### **Event-Driven Endpoints (New System)**

| Endpoint | Method | Purpose | Cache |
|----------|--------|---------|-------|
| `/api/events` | POST | Event ingestion | None |
| `/api/leaderboard/global` | GET | Global leaderboard | 10 min |
| `/api/tournaments/current` | GET | Current tournament | 5 min |
| `/api/tournaments/:id/leaderboard` | GET | Tournament rankings | 4 min |
| `/api/prizes/pending` | GET | Unclaimed prizes | 5 min |
| `/api/prizes/:id/claim` | POST | Claim prize | None |

### **Legacy Endpoints (Old System)**

All `/api/auth/*` and `/api/player/*` endpoints still work with JWT tokens.

---

## 📊 Performance Characteristics

| Metric | Target | Current |
|--------|--------|---------|
| Event ingestion | < 50ms | ✅ 30-40ms |
| Leaderboard update | < 10 min | ✅ 10 min (cron) |
| Tournament update | < 5 min | ✅ 4 min (cron) |
| API response (cached) | < 100ms | ✅ 50-80ms |
| Redis cache hit rate | > 80% | ✅ 85%+ |

---

## 🚀 Scalability

**Current Capacity:**
- ✅ Handles up to **10K DAU** with direct processing
- ✅ Redis caching reduces database load by 85%
- ✅ Batch event processing (up to 100 events per request)

**Future Scaling (100K+ DAU):**
- Add Bull queue with Redis for async processing
- Horizontal scaling with multiple backend instances
- Database read replicas for analytics queries

---

## 📝 Code Organization

```
railway-backend/
├── database/
│   └── migrations/
│       ├── 001_events_table.sql          # Events + tournament_events
│       ├── 002_event_leaderboards.sql    # Leaderboard tables
│       ├── 003_prizes.sql                # Prize table
│       ├── 004_analytics_aggregates.sql  # Analytics tables
│       └── 005_performance_indexes.sql   # Optimization indexes
├── services/
│   ├── event-processor.js       # Event validation
│   ├── event-schemas.js         # Joi schemas (28 events)
│   ├── leaderboard-aggregator.js # Global leaderboard cron
│   ├── tournament-manager.js    # Tournament lifecycle (NEW)
│   ├── prize-calculator.js      # Prize distribution
│   └── analytics-aggregator.js  # KPI calculations
├── routes/
│   ├── events.js               # POST /api/events
│   ├── leaderboards-v2.js      # GET /api/leaderboard/*
│   ├── tournaments-v2.js       # GET /api/tournaments/*
│   └── prizes-v2.js            # GET /api/prizes/*
└── server.js                   # Main app + cron jobs
```

---

## 🔒 Security Notes

- **Device ID based** - No email/password in event system
- **JWT tokens** - Still used for legacy endpoints
- **Rate limiting** - 100 requests/min per IP
- **Event validation** - All events validated before storage
- **SQL injection protection** - Parameterized queries everywhere

---

## 📚 Related Documentation

- `DEPLOYMENT.md` - Deployment guide with Railway
- `TESTING.md` - Testing guide (60+ tests)
- `SCALABILITY_ANALYSIS.md` - Scaling to 100K+ DAU
- `RAILWAY_BACKEND_MIGRATION_PLAN.md` - Full migration plan

---

## ❓ Common Questions

### Q: Why two systems (JWT + Event-Driven)?
**A:** Backward compatibility. Old users still work, new users use events.

### Q: What is `tournament_events` for?
**A:** It's a junction table to track which `game_ended` events have been processed for each tournament. **NOT** a log of tournament lifecycle events.

### Q: Why not log tournament lifecycle events?
**A:** They're logged to standard logs (Winston), not database. Database is for game events only.

### Q: Can I delete the old JWT system?
**A:** Yes, but only after ensuring no active users rely on it. Check analytics first.

---

**End of Architecture Overview**

