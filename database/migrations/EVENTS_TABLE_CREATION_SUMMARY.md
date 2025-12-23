# Events Table Creation - Complete Flow Analysis

## 📊 Full Flow: Flutter App → Backend → Database

### 1. Flutter App Event Structure

**Event Class** (`lib/core/events/event.dart`):
```dart
{
  event_type: String,        // e.g., "game_ended", "level_completed"
  user_id: String,          // Device ID from DeviceIdentityManager
  session_id: String,       // Current session ID
  timestamp: ISO String,     // When event occurred
  // Plus all event-specific data merged into root:
  app_version: String,      // Auto-injected
  platform: String,         // "ios" or "android" (auto-injected)
  campaign_id: String?,     // Auto-injected if available
  locale: String?,          // Auto-injected if available
  // ... event-specific fields (score, level_id, etc.)
}
```

**EventBus** (`lib/core/events/event_bus.dart`):
- Sends events to: `POST /api/events`
- Batches up to 50 events per request
- Auto-flushes every 15 seconds
- Stores locally in SQLite if offline

### 2. Backend Event Processing

**Event Processor** (`railway-backend/services/event-processor.js`):
```javascript
// Stores event as:
INSERT INTO events (event_type, user_id, payload, received_at)
VALUES ($1, $2, $3, NOW())

// Where:
// - event_type: extracted from event.event_type
// - user_id: extracted from event.user_id  
// - payload: entire event object as JSONB
// - received_at: NOW()
```

**Special Handling**:
- Extracts `campaign_id` from payload and stores in `campaign_id` column (migration 021)
- Updates `users` table for `nickname_changed` events
- Stores in `user_acquisitions` for `user_acquired` events
- Stores in `performance_metrics` for performance events
- Stores in `crash_logs` for crash events

### 3. Database Schema

**Events Table Structure** (from migrations 001 + 021):
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,              -- Entire event object
  campaign_id VARCHAR(255),             -- Extracted from payload (migration 021)
  received_at TIMESTAMP WITH TIME ZONE,
  processed_at TIMESTAMP WITH TIME ZONE,  -- NULL = unprocessed
  processing_attempts INT DEFAULT 0,
  processing_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE
);
```

### 4. Analytics Dashboard Dependencies

**Materialized Views** (migrations 027-030) query `events` table:
- `daily_aggregations` - Daily metrics
- `cohort_aggregations` - Retention by cohort
- `campaign_aggregations` - ROI by campaign
- `weekly_aggregations` - Weekly metrics

**Dashboard Queries** (`railway-backend/routes/dashboard-api.js`):
- Queries `events` table directly for real-time data
- Uses `payload->>'field'` to extract event-specific data
- Filters by `event_type`, `user_id`, `received_at`, `campaign_id`

### 5. Event Types (33 total)

**User Lifecycle** (5):
- `app_installed`, `app_launched`, `user_registered`, `settings_changed`, `app_uninstalled`

**User Acquisition** (2):
- `user_installed`, `user_acquired`

**Game Session** (8):
- `game_started`, `game_ended`, `game_paused`, `game_resumed`, `continue_used`
- `level_started`, `level_completed`, `level_failed`

**Economy** (4):
- `currency_earned`, `currency_spent`, `purchase_initiated`, `purchase_completed`

**Progression** (6):
- `skin_unlocked`, `skin_equipped`, `achievement_unlocked`, `mission_completed`
- `daily_streak_claimed`, `level_unlocked`

**Social & Engagement** (5):
- `leaderboard_viewed`, `tournament_entered`, `ad_watched`, `share_clicked`, `notification_received`

**Bonus** (1):
- `bonus_collected`

**Performance** (4):
- `performance_metrics`, `app_load_time`, `game_load_time`, `memory_usage`

**Crash/Error** (2):
- `app_crashed`, `app_error`

## ✅ Migration 019: Create Events Table

**File**: `019_create_events_table_complete.sql`

**What it does**:
1. Creates `events` table with all required columns
2. Includes `campaign_id` column (from migration 021)
3. Adds all constraints (event_type validation, user_id, payload, etc.)
4. Creates all required indexes for performance
5. Ready for partitioning in migration 025

**Run this BEFORE migration 025**

## 📋 Execution Order

1. ✅ **Migration 019**: Create events table (run this now)
2. ⏭️ **Migration 025**: Partition events table (after 019 succeeds)
3. ⏭️ **Migration 026**: Add partition indexes
4. ⏭️ **Migration 027-030**: Create materialized views

## 🔍 Verification

After running migration 019, verify:
```sql
-- Check table exists
SELECT 1 FROM information_schema.tables WHERE table_name = 'events';

-- Check campaign_id column exists
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'events' AND column_name = 'campaign_id';

-- Check indexes exist
SELECT indexname FROM pg_indexes WHERE tablename = 'events';
```

## 🎯 Next Steps

1. Run `019_create_events_table_complete.sql` in Railway PostgreSQL CLI
2. Verify success message: `✅ Migration 019_create_events_table_complete.sql completed successfully`
3. Then proceed with migration 025 (partitioning)

