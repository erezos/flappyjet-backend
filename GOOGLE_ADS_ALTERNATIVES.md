# 🔄 Alternatives to Google Ads API

If you're having trouble setting up the Google Ads API, here are several alternatives to get campaign cost data into your system.

---

## ✅ Option 1: Manual CSV Export + Automated Import (Recommended)

**Best for:** Quick setup, no API approval needed

### How it works:
1. Export campaign costs from Google Ads UI (daily/weekly)
2. Run a script to import the CSV into your database
3. Optionally: Set up a scheduled task to remind you to import

### Steps:

#### 1. Export from Google Ads:
1. Go to [Google Ads](https://ads.google.com/)
2. Click **Reports** (or use the search bar: "Campaign performance")
3. Create a custom report with these columns:
   - Campaign ID
   - Campaign name
   - Date
   - Cost
   - Impressions
   - Clicks
   - Conversions (installs)
4. Set date range (e.g., yesterday, last 7 days)
5. Click **Download** → **CSV**

#### 2. Format the CSV:
Your CSV should look like this (with header row):

```csv
campaign_id,campaign_name,date,cost_usd,impressions,clicks,installs
1234567890,Summer Sale 2025,2025-12-22,150.50,50000,2500,125
1234567891,Winter Campaign,2025-12-22,200.00,75000,3000,150
```

**Required columns:**
- `campaign_id` - Google Ads campaign ID
- `date` - Date in YYYY-MM-DD format
- `cost_usd` - Cost in USD

**Optional columns:**
- `campaign_name` - Campaign name
- `impressions` - Number of impressions
- `clicks` - Number of clicks
- `installs` - Number of installs/conversions

#### 3. Import the CSV:

```bash
# From Railway CLI
railway run node scripts/import-campaign-costs-csv.js costs.csv

# Or locally (if connected to production DB)
cd railway-backend
node scripts/import-campaign-costs-csv.js costs.csv
```

**Or via stdin:**
```bash
cat costs.csv | railway run node scripts/import-campaign-costs-csv.js
```

---

## ✅ Option 2: Google Sheets + Google Ads Add-on

**Best for:** Semi-automated, visual interface

### How it works:
1. Use Google Sheets with Google Ads connector
2. Set up automatic refresh
3. Export/import via script

### Steps:

1. **Create Google Sheet:**
   - Go to [Google Sheets](https://sheets.google.com/)
   - Create new spreadsheet
   - Name it "Campaign Costs"

2. **Add Google Ads Data:**
   - Go to **Extensions** → **Add-ons** → **Get add-ons**
   - Search for "Google Ads" or "Supermetrics"
   - Install a Google Ads connector

3. **Connect to Google Ads:**
   - Authorize the add-on
   - Select metrics: Campaign ID, Date, Cost, Impressions, Clicks, Conversions
   - Set auto-refresh (daily)

4. **Export to CSV:**
   - Export the sheet as CSV
   - Use the import script from Option 1

---

## ✅ Option 3: Google Ads Editor Export

**Best for:** Bulk historical data

### Steps:

1. Download [Google Ads Editor](https://ads.google.com/home/tools/ads-editor/)
2. Sign in and download your account
3. Export campaign performance data
4. Format as CSV and import using Option 1 script

---

## ✅ Option 4: Third-Party Tools (Paid)

**Best for:** Fully automated, no coding

### Options:
- **Supermetrics** - Connects Google Ads to databases
- **Funnel.io** - Marketing data integration platform
- **Stitch** - ETL tool for marketing data

**Cost:** Usually $50-200/month

---

## ✅ Option 5: Simplified Manual Entry

**Best for:** Small number of campaigns, occasional updates

### Create a simple web form or use Railway's database directly:

```sql
-- Manual entry via SQL
INSERT INTO campaign_costs (
  campaign_id, campaign_name, date, cost_usd, impressions, clicks, installs
) VALUES (
  '1234567890', 'Summer Sale', '2025-12-22', 150.50, 50000, 2500, 125
)
ON CONFLICT (campaign_id, date) DO UPDATE SET
  cost_usd = EXCLUDED.cost_usd,
  impressions = EXCLUDED.impressions,
  clicks = EXCLUDED.clicks,
  installs = EXCLUDED.installs;
```

---

## 🎯 Recommended Workflow (Option 1)

**Daily/Weekly Process:**

1. **Monday morning:** Export last week's data from Google Ads
2. **Import:** Run the CSV import script
3. **Verify:** Check dashboard shows updated ROI data

**Time required:** ~5 minutes per week

**Script location:** `railway-backend/scripts/import-campaign-costs-csv.js`

---

## 📊 What You'll Get

Once costs are imported (via any method), your dashboard will automatically show:

- ✅ Campaign ROI (revenue vs cost)
- ✅ CPI (Cost Per Install)
- ✅ Campaign performance metrics
- ✅ Cohort ROI analysis
- ✅ All materialized views will include cost data

**The dashboard queries will work the same regardless of how you import the data!**

---

## 🚀 Quick Start (CSV Import)

1. Export yesterday's campaign costs from Google Ads as CSV
2. Format it with the required columns (see above)
3. Run: `railway run node scripts/import-campaign-costs-csv.js your-file.csv`
4. Check dashboard - ROI data should appear!

---

## 💡 Pro Tip

You can set up a **weekly reminder** to export and import:
- Use a calendar reminder
- Or create a simple cron job that emails you a reminder
- Or use Railway's scheduled tasks to remind you

The import script is idempotent (safe to run multiple times) - it will update existing records if you re-import the same data.

---

**Bottom line:** You don't need the Google Ads API! CSV import works perfectly and takes just a few minutes per week. 🎉

