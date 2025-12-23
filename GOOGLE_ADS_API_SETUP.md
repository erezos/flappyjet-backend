# 🔐 Google Ads API Setup Guide

Complete guide to obtain all required credentials for automated campaign cost import.

---

## 📋 Prerequisites

1. **Google Ads Account** - You need an active Google Ads account with campaigns running
2. **Google Cloud Project** - Create or use an existing project in [Google Cloud Console](https://console.cloud.google.com/)

---

## 🔑 Step 1: Get Google Ads Developer Token

**Developer Token** is required to access Google Ads API.

### Steps:
1. Go to [Google Ads](https://ads.google.com/)
2. Sign in with your Google Ads account
3. **Important:** Click the **Tools & Settings** icon (🔧 wrench icon) in the **top right corner** of the page (NOT the "Tools" in the left sidebar)
4. In the dropdown menu, look for the **Setup** section (usually near the bottom)
5. Under **Setup**, click **API Center**
6. If you don't have a developer token:
   - Click **Apply for a developer token**
   - Fill out the application form
   - Wait for approval (usually 1-2 business days)
7. Once approved, copy your **Developer Token** (looks like: `abc123xyz789`)

**Visual Guide:**
- Top right corner → 🔧 **Tools & Settings** (wrench icon) → **Setup** → **API Center**
- ⚠️ NOT the "Tools" section in the left sidebar (that's different!)

**Save this as:** `GOOGLE_ADS_DEVELOPER_TOKEN`

---

## 🆔 Step 2: Get Google Ads Customer ID

**Customer ID** identifies which Google Ads account to query.

### Steps:
1. In [Google Ads](https://ads.google.com/), look at the **top right corner** of the page
2. You'll see your **Customer ID** displayed (format: `123-456-7890` or `1234567890`)
   - It's usually shown next to your account name/email
   - Sometimes it's in a dropdown when you click your account name
3. Copy this ID (remove dashes if present - use format: `1234567890`)

**Alternative method:**
- Click the **Tools & Settings** icon (🔧) → **Setup** → **Account settings**
- Your Customer ID is displayed at the top

**Save this as:** `GOOGLE_ADS_CUSTOMER_ID`

**Note:** If you have multiple accounts, use the Manager Account (MCC) ID for access to all sub-accounts.

---

## 🔐 Step 3: Create OAuth2 Credentials (Client ID & Secret)

**OAuth2 credentials** authenticate your backend with Google Ads API.

### Steps:

#### 3.1. Create Google Cloud Project (if needed)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Name it (e.g., "FlappyJet Ads API")
4. Click **Create**

#### 3.2. Enable Google Ads API
1. In your Google Cloud project, go to **APIs & Services** → **Library**
2. Search for **"Google Ads API"**
3. Click on it and click **Enable**

#### 3.3. Create OAuth2 Credentials
1. Go to **APIs & Services** → **Credentials**
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. If prompted, configure OAuth consent screen:
   - **User Type:** Internal (if using Google Workspace) or External
   - **App name:** FlappyJet Backend
   - **User support email:** Your email
   - **Developer contact:** Your email
   - Click **Save and Continue**
   - **Scopes:** Add `https://www.googleapis.com/auth/adwords`
   - Click **Save and Continue**
   - **Test users:** Add your Google account email
   - Click **Save and Continue**
4. **Application type:** Select **Web application**
5. **Name:** FlappyJet Backend API
6. **Authorized redirect URIs:** 
   - Add: `http://localhost:3000/oauth2callback` (for testing)
   - Add: `https://your-railway-domain.up.railway.app/oauth2callback` (for production)
7. Click **Create**
8. **Copy the Client ID and Client Secret**

**Save these as:**
- `GOOGLE_ADS_CLIENT_ID` = The Client ID
- `GOOGLE_ADS_CLIENT_SECRET` = The Client Secret

---

## 🔄 Step 4: Get OAuth2 Refresh Token

**Refresh Token** allows your backend to get new access tokens automatically.

### Option A: Using OAuth2 Playground (Easiest)

1. Go to [OAuth2 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in top right
3. Check **"Use your own OAuth credentials"**
4. Enter your **Client ID** and **Client Secret** from Step 3
5. In the left panel, find **"Google Ads API"** → Expand it
6. Check the scope: `https://www.googleapis.com/auth/adwords`
7. Click **Authorize APIs**
8. Sign in with your Google account (the one with Google Ads access)
9. Click **Allow** to grant permissions
10. Click **Exchange authorization code for tokens**
11. **Copy the Refresh Token** (looks like: `1//abc123xyz789...`)

**Save this as:** `GOOGLE_ADS_REFRESH_TOKEN`

### Option B: Using a Script (More Control)

Create a script to generate the refresh token:

```javascript
// generate-refresh-token.js
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_ADS_CLIENT_ID,
  process.env.GOOGLE_ADS_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback' // Redirect URI
);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/adwords'],
  prompt: 'consent' // Force refresh token generation
});

console.log('Visit this URL to authorize:');
console.log(authUrl);
console.log('\nAfter authorization, you\'ll be redirected. Copy the "code" parameter from the URL.');

// Then exchange code for tokens:
// oauth2Client.getToken(code).then(({ tokens }) => {
//   console.log('Refresh Token:', tokens.refresh_token);
// });
```

---

## ✅ Step 5: Add Credentials to Railway

1. Go to your Railway project: [railway.app](https://railway.app)
2. Select your **flappyjet-backend** service
3. Go to **Variables** tab
4. Add each environment variable:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `GOOGLE_ADS_CLIENT_ID` | From Step 3 | `123456789-abc.apps.googleusercontent.com` |
| `GOOGLE_ADS_CLIENT_SECRET` | From Step 3 | `GOCSPX-abc123xyz789` |
| `GOOGLE_ADS_REFRESH_TOKEN` | From Step 4 | `1//abc123xyz789...` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | From Step 1 | `abc123xyz789` |
| `GOOGLE_ADS_CUSTOMER_ID` | From Step 2 | `1234567890` |

5. Click **Deploy** or wait for auto-deploy

---

## 🧪 Step 6: Test the Setup

Once credentials are added, the cron job will run daily at 5 AM. You can also test manually:

### Option A: Via Railway CLI
```bash
railway run node -e "
const CampaignCostImporter = require('./services/campaign-cost-importer');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const importer = new CampaignCostImporter(pool);
importer.importCosts().then(result => {
  console.log('Import result:', result);
  process.exit(0);
});
"
```

### Option B: Create a Test Script
Create `railway-backend/scripts/test-google-ads-import.js`:

```javascript
require('dotenv').config();
const { Pool } = require('pg');
const CampaignCostImporter = require('../services/campaign-cost-importer');

async function test() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    const importer = new CampaignCostImporter(pool);
    console.log('🧪 Testing Google Ads API import...');
    const result = await importer.importCosts();
    console.log('✅ Import result:', result);
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

test();
```

Run: `node scripts/test-google-ads-import.js`

---

## 📊 Step 7: Verify Data Import

Check if costs were imported:

```sql
SELECT 
  campaign_id,
  campaign_name,
  date,
  cost_usd,
  impressions,
  clicks,
  installs
FROM campaign_costs
ORDER BY date DESC, campaign_id
LIMIT 20;
```

---

## ⚠️ Troubleshooting

### "Google Ads API not configured"
- Check all 5 environment variables are set in Railway
- Verify variable names match exactly (case-sensitive)

### "Authentication failed"
- Verify `GOOGLE_ADS_CLIENT_ID` and `GOOGLE_ADS_CLIENT_SECRET` are correct
- Check `GOOGLE_ADS_REFRESH_TOKEN` is valid (regenerate if needed)

### "Developer token not approved"
- Wait for Google Ads API approval (1-2 business days)
- Check approval status in Google Ads → Tools & Settings → API Center

### "Customer ID not found"
- Verify `GOOGLE_ADS_CUSTOMER_ID` is correct (no dashes)
- Ensure the OAuth account has access to this Google Ads account

### "No campaign costs found"
- Check if you have active campaigns on that date
- Verify the date range in Google Ads matches your query

---

## 🔗 Useful Links

- [Google Ads API Documentation](https://developers.google.com/google-ads/api/docs/start)
- [OAuth2 Playground](https://developers.google.com/oauthplayground/)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Google Ads](https://ads.google.com/)

---

## 📝 Quick Checklist

- [ ] Developer Token obtained from Google Ads API Center
- [ ] Customer ID copied from Google Ads account
- [ ] Google Cloud project created
- [ ] Google Ads API enabled in Cloud project
- [ ] OAuth2 credentials created (Client ID & Secret)
- [ ] Refresh Token generated via OAuth2 Playground
- [ ] All 5 environment variables added to Railway
- [ ] Test import successful
- [ ] Data visible in `campaign_costs` table

---

**Once all credentials are set, the automated daily import will start working!** 🎉

