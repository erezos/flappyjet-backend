# 📊 Analytics Materialized Views - Refresh Setup

## ✅ Setup Complete

All analytics materialized views have been created and are ready for use:

1. **daily_aggregations** - Daily metrics (90 days retention)
2. **cohort_aggregations** - Retention & LTV by cohort (90 days retention)
3. **campaign_aggregations** - ROI metrics by campaign (90 days retention)
4. **weekly_aggregations** - Weekly metrics (52 weeks retention)

## 🔄 Automated Refresh (Already Configured)

The refresh is already configured in `server.js` with cron jobs:

### Daily Refresh (3 AM UTC)
- Refreshes: `daily_aggregations`, `cohort_aggregations`, `campaign_aggregations`
- Schedule: `0 3 * * *` (Every day at 3 AM UTC)
- Uses: `REFRESH MATERIALIZED VIEW CONCURRENTLY` (non-blocking)

### Weekly Refresh (Monday 4 AM UTC)
- Refreshes: `weekly_aggregations`
- Schedule: `0 4 * * 1` (Every Monday at 4 AM UTC)
- Uses: `REFRESH MATERIALIZED VIEW CONCURRENTLY` (non-blocking)

## 🚀 Initial Refresh (Run Once)

After deployment, run the initial refresh to populate the views:

```bash
# On Railway (via CLI or one-off command)
npm run refresh-analytics:production

# Or manually via Railway dashboard
# Go to your service → Run Command → Enter:
node scripts/refresh-analytics-views.js --all
```

## 📝 Manual Refresh Scripts

### Refresh All Views
```bash
npm run refresh-analytics:production
# or
node scripts/refresh-analytics-views.js --all
```

### Refresh Only Daily Views
```bash
node scripts/refresh-analytics-views.js --daily
```

### Refresh Only Weekly Views
```bash
node scripts/refresh-analytics-views.js --weekly
```

## 🔍 View Statistics

Check view statistics programmatically:

```javascript
const MaterializedViewRefresher = require('./services/materialized-view-refresher');
const refresher = new MaterializedViewRefresher(db);
const stats = await refresher.getViewStats();
console.log(stats);
```

## 📊 Service Details

The refresh service is located at:
- **Service**: `services/materialized-view-refresher.js`
- **Script**: `scripts/refresh-analytics-views.js`
- **Cron Jobs**: Configured in `server.js` (lines 935-966)

## ⚠️ Important Notes

1. **CONCURRENT Refresh**: All refreshes use `CONCURRENTLY` to avoid blocking reads
2. **Indexes Required**: CONCURRENT refresh requires unique indexes (already created in migrations)
3. **Timing**: Refreshes run during low-traffic hours (3-4 AM UTC)
4. **Error Handling**: Errors are logged but don't crash the server

## 🎯 Next Steps

1. ✅ Migrations completed
2. ✅ Cron jobs configured
3. ✅ Refresh script created
4. ⏳ **Run initial refresh after deployment** (see above)
5. ⏳ Monitor logs to ensure refreshes complete successfully

## 📈 Monitoring

Check refresh status in logs:
- Look for: `📊 ✅ Materialized views refreshed successfully`
- Check for errors: `📊 ❌ Materialized view refresh error`

View statistics are logged before and after each refresh.

