# 🔍 Dashboard Analytics Issues - Deep Investigation

**Date:** November 19, 2025  
**Reporter:** User  
**Status:** 🔴 CRITICAL - Multiple tracking issues found

---

## 📊 Reported Issues

### ❌ ISSUE #1: Games Started = 0, Games Ended = 22
**Problem:** Completion rate shows 0% because no `game_started` events are being tracked

### ❌ ISSUE #2: Games per Player = 0
**Problem:** Derived from Games Started / DAU, incorrectly calculates to 0

### ❌ ISSUE #3: Avg Session = 53 minutes
**Problem:** Seems unreasonably high - need to verify calculation logic

### ❌ ISSUE #4: Avg Game Time = 45 minutes  
**Problem:** Impossible - need to understand measurement method

### ❌ ISSUE #5: Continue Usage Chart Empty
**Problem:** Recent `continue_used` event visible in activity feed, but chart shows no data

### ❌ ISSUE #6: Jet Skin Purchase Not Visible
**Problem:** User just purchased a jet skin, but it doesn't appear in "Top Jets/Skins Purchased" chart

---

## 🔍 ROOT CAUSE ANALYSIS

### Investigation Method:
1. ✅ Reviewed Flutter EventBus implementation
2. ✅ Checked event firing points in game code
3. ✅ Analyzed backend event schemas
4. ✅ Examined dashboard query logic

---

## 🎮 FLUTTER EVENT FIRING - ACTUAL BEHAVIOR

### ❌ `game_started` Event - **NOT SENT TO BACKEND**

**Location:** `lib/game/flappy_game.dart:471-508`

```dart
void _handleGameStart() {
  _gameStateManager.startGame();

  // 📊 Track game start analytics
  _analytics.trackGameStart(  // ← Goes to Firebase ONLY
    gameMode: 'endless',
    selectedJet: InventoryManager().equippedSkinId,
    theme: _gameStateManager.currentTheme.displayName,
    playerLevel: 1,
    totalCoins: InventoryManager().softCurrency,
    totalGems: InventoryManager().gems,
  );

  // OLD: ComprehensiveAnalyticsManager().trackGameStart() removed - now using EventBus
  // ^ COMMENT IS MISLEADING - EventBus is NOT being used!
  
  // ...no EventBus.fire('game_started', ...) call!
}
```

**UnifiedAnalyticsManager.trackGameStart():**
```dart
void trackGameStart(...) {
  trackEvent('game_start', {  // ← Note: 'game_start' not 'game_started'
    'game_mode': gameMode,
    // ...
  });
}

void trackEvent(String eventName, Map<String, dynamic> parameters) {
  // Track to Firebase (synchronous, but lightweight)
  _firebaseAnalytics?.trackEvent(eventName, parameters);

  // ❌ DISABLED: SmartRailwayAnalytics (using deprecated endpoint)
  // Railway events are now handled by EventBus directly via /api/events
  // _railwayAnalytics?.trackEvent(eventName, parameters);
  // ^ EventBus is NOT called here either!
}
```

**Conclusion:** `game_started` events go to **Firebase ONLY**, not to Railway backend!

---

### ✅ `game_ended` Event - **CORRECTLY SENT**

**Location:** `lib/game/flappy_game.dart:859-882`

```dart
void _gameOver() {
  // 🏆 Fire game_ended event for backend analytics (single source of truth)
  if (eventBus != null) {
    eventBus!.fire('game_ended', {  // ✅ CORRECT: Using EventBus
      'game_mode': gameMode,
      'score': _gameStateManager.score,
      'duration_seconds': (_gameStateManager.getElapsedGameTime() / 1000).round(),
      'obstacles_dodged': _gameStateManager.score,
      'coins_collected': _gameStateManager.coinsCollectedThisRun,
      'gems_collected': _gameStateManager.gemsCollectedThisRun,
      'hearts_remaining': _gameStateManager.lives,
      'cause_of_death': _gameStateManager.causeOfDeath,
      'max_combo': 0,
      'powerups_used': <String>[],
    });
  }
}
```

**Conclusion:** `game_ended` events **DO** go to Railway backend via EventBus!

---

### ✅ `continue_used` Event - **SENT BUT SCHEMA MISMATCH**

**Location:** `lib/game/systems/game_state_manager.dart:226-235`

```dart
// Fire continue_used event for analytics
_eventBus?.fire('continue_used', {
  'game_mode': 'endless',
  'score_at_death': score,
  'continue_type': continueType,  // ✅ CORRECT
  'cost_coins': costCoins,        // ✅ CORRECT
  'cost_gems': costGems,          // ✅ CORRECT
  'lives_restored': 1,            // ✅ CORRECT
  'continues_used_this_run': _continuesUsedThisRun, // ✅ CORRECT
});
```

**Backend Schema:** `railway-backend/services/event-schemas.js:140-151`

```javascript
const continueUsedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('continue_used').required(),
  game_mode: Joi.string().valid('endless', 'story').required(), // ✅ MATCHES
  score_at_death: Joi.number().integer().min(0).required(),     // ✅ MATCHES
  continue_type: Joi.string().valid('ad_watch', 'gem_purchase', 'coin_purchase').required(), // ✅ MATCHES
  cost_coins: Joi.number().integer().min(0).required(),         // ✅ MATCHES
  cost_gems: Joi.number().integer().min(0).required(),          // ✅ MATCHES
  lives_restored: Joi.number().integer().min(1).required(),     // ✅ MATCHES
  continues_used_this_run: Joi.number().integer().min(1).required(), // ✅ MATCHES
});
```

**Conclusion:** Schema is **CORRECT**, event is **SENT**. Issue must be in dashboard query!

---

### ❌ Skin Purchase Event - **WRONG EVENT NAME**

**Location:** `lib/game/systems/game_events_tracker.dart:194-217`

```dart
Future<void> onSkinPurchased({
  required String skinId,
  required int coinCost,
  required String rarity,
}) async {
  // 📊 Report analytics
  _analytics?.trackPurchase(  // ← Goes to Firebase
    itemId: skinId,
    itemName: 'jet_skin_$skinId',
    price: coinCost.toDouble(),
    currency: 'coins',
    purchaseType: 'coins',
  );
  
  // NO EventBus call! ❌
}
```

**FirebaseAnalyticsManager.trackPurchase():**
```dart
Future<void> trackPurchase({
  required String itemId,
  required String itemName,
  required double price,
  required String currency,
  required String purchaseType,
}) async {
  await trackEvent('purchase', {  // ← Firebase only, generic 'purchase' event
    'item_id': itemId,
    'item_name': itemName,
    'price': price,
    'currency': currency,
    'purchase_type': purchaseType,
  });
}
```

**Backend Expects:** `skin_purchased` event (line 210-221 in event-schemas.js)

```javascript
const skinPurchasedSchema = Joi.object({
  ...baseFields,
  event_type: Joi.string().valid('skin_purchased').required(), // ← Expects 'skin_purchased'
  jet_id: Joi.string().required(),
  jet_name: Joi.string().required(),
  purchase_type: Joi.string().valid('coins', 'gems', 'real_money').required(),
  cost_coins: Joi.number().integer().min(0).required(),
  cost_gems: Joi.number().integer().min(0).required(),
  rarity: Joi.string().required(),
});
```

**Conclusion:** Flutter sends **NO skin_purchased event to backend**! Only Firebase gets a generic `purchase` event!

---

## 📊 DASHBOARD QUERY ANALYSIS

### Issue #3 & #4: Session & Game Time Calculations

**Current Logic** (`railway-backend/routes/dashboard-api.js:76-89`):

```javascript
// Average session duration (last 7 days)
db.query(`
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
  ) sessions
`),
```

**Problem:**  
- Calculates session duration as **MAX(received_at) - MIN(received_at)** across ALL events
- If a user opens the app, plays multiple games over 50+ minutes, then quits:
  - First event: `app_launched` at 10:00 AM
  - Last event: `game_ended` at 10:53 AM
  - Session duration = **53 minutes** ✅ This is CORRECT!

**"Avg Game Time" Calculation** (`dashboard.html:493`):

```javascript
const avgGameTime = data.games_ended > 0 
  ? Math.floor(data.avg_session_seconds / (data.games_ended / Math.max(data.dau, 1))) 
  : 0;
```

**Math Breakdown:**
- `avg_session_seconds` = 3180 (53 minutes)
- `games_ended` = 22
- `dau` = 19
- Formula: `3180 / (22 / 19)` = `3180 / 1.16` = **2741 seconds = 45.7 minutes**

**Problem:** This formula is completely wrong! It should be:

```javascript
// If we have game_ended events with duration, calculate average directly from those
// Otherwise, estimate as: total_session_time / total_games
const avgGameTime = totalGameDuration / games_ended;
```

---

### Issue #5: Continue Usage Chart Query

**Dashboard Query** (`railway-backend/routes/dashboard-api.js:479-513`):

```javascript
router.get('/continues', async (req, res) => {
  try {
    const data = await getCachedQuery('continues-analysis', async () => {
      // Total continues by type
      const byTypeResult = await db.query(`
        SELECT 
          payload->>'continue_type' as continue_type,
          COUNT(*) as total_uses,
          ROUND(AVG((payload->>'score_at_death')::int)) as avg_score,
          SUM((payload->>'cost_gems')::int) as total_gems_spent
        FROM events
        WHERE event_type = 'continue_used'
          AND received_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY payload->>'continue_type'
      `);
      // ...
    });
    res.json(data);
  } catch (error) {
    logger.error('📊 Error fetching continues:', error);
    res.status(500).json({ error: 'Failed to fetch continues data' });
  }
});
```

**Problem:** Query looks correct! Issue might be:
1. **Cache:** Old cached data before continue event was sent (TTL = 1 hour)
2. **Frontend not updating:** Chart might not be reloading

---

### Issue #6: Jet Skin Purchases Chart Query

**Dashboard Query** (`railway-backend/routes/dashboard-api.js:625-670`):

```javascript
router.get('/purchases', async (req, res) => {
  try {
    const data = await getCachedQuery('purchases-analysis', async () => {
      // Top 5 purchased jets/skins
      const topItemsResult = await db.query(`
        SELECT 
          payload->>'jet_id' as item_id,
          payload->>'jet_name' as item_name,
          payload->>'rarity' as rarity,
          COUNT(*) as purchases,
          SUM((payload->>'cost_coins')::int) as total_coins,
          SUM((payload->>'cost_gems')::int) as total_gems
        FROM events
        WHERE event_type = 'skin_purchased'  // ← Looking for 'skin_purchased'
          AND received_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY 
          payload->>'jet_id',
          payload->>'jet_name',
          payload->>'rarity'
        ORDER BY purchases DESC
        LIMIT 5
      `);
      // ...
    });
    res.json(data);
  } catch (error) {
    logger.error('📊 Error fetching purchases:', error);
    res.status(500).json({ error: 'Failed to fetch purchases data' });
  }
});
```

**Problem:** Query expects `skin_purchased` events, but **Flutter never sends them to backend**!

---

## 🔧 FIXES REQUIRED

### Fix #1: Add `game_started` EventBus Call ✅

**File:** `lib/game/flappy_game.dart`

**Change:**
```dart
void _handleGameStart() {
  _gameStateManager.startGame();

  // 📊 Track game start analytics (Firebase)
  _analytics.trackGameStart(
    gameMode: 'endless',
    selectedJet: InventoryManager().equippedSkinId,
    theme: _gameStateManager.currentTheme.displayName,
    playerLevel: 1,
    totalCoins: InventoryManager().softCurrency,
    totalGems: InventoryManager().gems,
  );

  // 📊 Track game start for backend (EventBus)
  eventBus?.fire('game_started', {  // ✅ NEW
    'game_mode': 'endless',
    'selected_jet': InventoryManager().equippedSkinId,
    'selected_skin': InventoryManager().equippedSkinId,
    'hearts_remaining': _gameStateManager.lives,
    'powerups_active': <String>[],
  });

  // ... rest of method
}
```

---

### Fix #2: Add `skin_purchased` EventBus Call ✅

**File:** `lib/game/systems/game_events_tracker.dart`

**Change:**
```dart
Future<void> onSkinPurchased({
  required String skinId,
  required int coinCost,
  required String rarity,
}) async {
  // Check collection achievements
  int ownedCount = 0;
  if (_inventory != null && _achievementsManager != null) {
    ownedCount = _inventory!.ownedSkinIds.length;
    await _achievementsManager!.checkCollectionAchievements(ownedCount);
  }

  // 📊 Report analytics to Firebase
  _analytics?.trackPurchase(
    itemId: skinId,
    itemName: 'jet_skin_$skinId',
    price: coinCost.toDouble(),
    currency: 'coins',
    purchaseType: 'coins',
  );

  // 📊 Send to backend via EventBus ✅ NEW
  EventBus().fire('skin_purchased', {
    'jet_id': skinId,
    'jet_name': 'jet_skin_$skinId',
    'purchase_type': coinCost > 0 ? 'coins' : 'gems',
    'cost_coins': coinCost,
    'cost_gems': 0, // TODO: Get actual gem cost if purchased with gems
    'rarity': rarity,
  });

  safePrint('🎮 Skin purchased: $skinId for $coinCost coins');
}
```

**Also update gem purchases in `store_purchase_handler.dart:156-186`:**

```dart
if (success) {
  await inventory.unlockSkin(skin.id);
  await inventory.equipSkin(skin.id);

  // 🏆 Track mythic jet purchase for collection achievements
  final gameEvents = GameEventsTracker();
  await gameEvents.onSkinPurchased(
    skinId: skin.id,
    coinCost: 0, // No coins spent
    rarity: skin.rarity.name,
  );
  
  // ✅ NEW: Fire EventBus event for backend
  EventBus().fire('skin_purchased', {
    'jet_id': skin.id,
    'jet_name': skin.displayName,
    'purchase_type': 'gems',
    'cost_coins': 0,
    'cost_gems': gemPrice,
    'rarity': skin.rarity.name,
  });

  if (context.mounted) {
    _showSuccessSnackBar('🎉 Purchased exclusive ${skin.displayName}!');
  }
}
```

---

### Fix #3: Fix "Avg Game Time" Calculation ✅

**File:** `railway-backend/public/dashboard.html`

**Replace the derived metric calculation with:**

```javascript
// Calculate derived metrics
// Avg Game Time: Get from game_ended events directly
const avgGameTimeResult = await db.query(`
  SELECT 
    ROUND(AVG((payload->>'duration_seconds')::int)) as avg_duration
  FROM events
  WHERE event_type = 'game_ended'
    AND received_at >= CURRENT_DATE
    AND (payload->>'duration_seconds')::int > 0
`);
const avgGameTime = parseInt(avgGameTimeResult.rows[0]?.avg_duration || 0);
document.getElementById('avgGameTime').textContent = formatTime(avgGameTime);
```

**OR** update the frontend calculation to be simpler:

```javascript
// Simpler: If no started events, can't calculate games/player or avg game time
const avgGameTime = data.games_ended > 0 && data.avg_session_seconds > 0
  ? Math.floor(data.avg_session_seconds / Math.max(data.games_ended / Math.max(data.dau, 1), 1))
  : 0;
```

Actually, the correct formula should be:

```javascript
// Average game time should come from game_ended.duration_seconds, not session time!
// For now, estimate as: (session time * games per player) / games played
const gamesPerPlayer = data.dau > 0 ? data.games_ended / data.dau : 0;
const avgGameTime = gamesPerPlayer > 0 
  ? Math.floor(data.avg_session_seconds / gamesPerPlayer) 
  : 0;
```

But the BEST solution is to add this to the backend overview query!

---

### Fix #4: Add Avg Game Duration to Overview API ✅

**File:** `railway-backend/routes/dashboard-api.js`

**Add this query to the overview endpoint:**

```javascript
// Average game duration (from game_ended events)
db.query(`
  SELECT 
    ROUND(AVG((payload->>'duration_seconds')::int)) as avg_game_duration
  FROM events
  WHERE event_type = 'game_ended'
    AND received_at >= CURRENT_DATE
    AND (payload->>'duration_seconds')::int > 0
`)
```

And return it:

```javascript
return {
  dau: parseInt(dauResult.rows[0]?.dau || 0),
  total_players: parseInt(totalPlayersResult.rows[0]?.total_players || 0),
  avg_session_seconds: parseInt(avgSessionResult.rows[0]?.avg_session_seconds || 0),
  avg_game_duration: parseInt(avgGameDurationResult.rows[0]?.avg_game_duration || 0), // ✅ NEW
  games_started: parseInt(gamesResult.rows[0]?.games_started || 0),
  games_ended: parseInt(gamesResult.rows[0]?.games_ended || 0),
  completion_rate: parseFloat(gamesResult.rows[0]?.completion_rate || 0),
  last_updated: new Date().toIso8601String()
};
```

---

### Fix #5: Clear Cache for Continue & Purchase Data ⚠️

**Short-term fix:** Force refresh dashboard (Ctrl+Shift+R / Cmd+Shift+R)

**Long-term fix:** Reduce cache TTL for these endpoints to 5-10 minutes instead of 1 hour

**File:** `railway-backend/routes/dashboard-api.js`

Change cache TTL:

```javascript
// From:
const data = await getCachedQuery('continues-analysis', async () => {
  // ...
}, 3600); // 1 hour

// To:
const data = await getCachedQuery('continues-analysis', async () => {
  // ...
}, 600); // 10 minutes
```

---

## 📋 PRIORITY FIX ORDER

1. **🔴 HIGH:** Add `game_started` EventBus call (Flutter)
2. **🔴 HIGH:** Add `skin_purchased` EventBus call (Flutter)
3. **🟡 MEDIUM:** Add avg_game_duration to backend overview API
4. **🟡 MEDIUM:** Update dashboard to use avg_game_duration
5. **🟢 LOW:** Reduce cache TTL for economy metrics
6. **🟢 LOW:** Add admin cache-clear endpoint

---

## ✅ VALIDATION CHECKLIST

After fixes, verify:

- [ ] Games Started > 0 in dashboard
- [ ] Completion Rate = (Games Ended / Games Started) * 100
- [ ] Games per Player = Games Started / DAU
- [ ] Avg Game Time < 10 minutes (reasonable)
- [ ] Continue chart shows recent continues
- [ ] Purchases chart shows recent skin purchases
- [ ] Railway logs show `game_started` and `skin_purchased` events

---

**Next Step:** Implement Flutter fixes first, then backend improvements!

