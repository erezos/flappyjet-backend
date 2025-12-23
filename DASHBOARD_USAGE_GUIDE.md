# 📊 Dashboard Usage Guide - When to Check & Make Decisions

Guide to optimal dashboard check frequency and decision-making timelines.

---

## ⏰ Recommended Check Frequency

### **Daily Checks (5-10 minutes)**
**When:** Morning, after coffee ☕

**What to look at:**
- ✅ **DAU (Daily Active Users)** - Is today's traffic normal?
- ✅ **Games Started/Ended** - Any sudden drops?
- ✅ **Completion Rate** - Is it stable?
- ✅ **Revenue (Today)** - Any anomalies?

**Purpose:** **Health check** - catch issues early, verify everything is working

**Decision threshold:** Only act on **significant anomalies** (>20% change from baseline)

---

### **Weekly Deep Dive (30-60 minutes)**
**When:** Monday morning or Friday afternoon

**What to analyze:**
- 📈 **DAU Trend (7 days)** - Growth trajectory
- 📊 **Retention (D1, D7)** - User quality trends
- 💰 **Revenue Trends** - Monetization health
- 🎯 **Campaign ROI** - If running ads, check performance
- 📉 **Churn Rate** - User retention issues
- 🎮 **Level Performance** - Which levels are too hard/easy?

**Purpose:** **Strategic analysis** - identify trends, make adjustments

**Decision threshold:** Look for **sustained trends** (3+ days in same direction)

---

### **Monthly Review (1-2 hours)**
**When:** First Monday of the month

**What to analyze:**
- 📊 **Cohort Analysis** - Long-term retention patterns
- 💰 **LTV Trends** - User value over time
- 🎯 **Campaign Performance** - ROI by campaign
- 📈 **Growth Metrics** - MAU, new installs
- 🔄 **Feature Impact** - Did recent changes help/hurt?

**Purpose:** **Strategic planning** - major decisions, budget allocation

**Decision threshold:** **Clear patterns** over 2+ weeks

---

## 📅 Data Freshness & Update Schedule

### **Real-Time (Updated Every Request)**
- ✅ Current DAU (today)
- ✅ Games started/ended (today)
- ✅ Live activity feed

**Use for:** Immediate health checks

---

### **Daily Updates (Refreshed at 3 AM)**
- ✅ Daily aggregations (DAU, revenue, games)
- ✅ Completion rates
- ✅ Session metrics

**Use for:** Daily monitoring, trend analysis

---

### **Weekly Updates (Refreshed Monday 4 AM)**
- ✅ Weekly aggregations
- ✅ Cohort retention (D7, D30)
- ✅ Campaign ROI (if costs imported weekly)

**Use for:** Weekly reviews, strategic decisions

---

## 🎯 Decision-Making Timelines

### **Immediate Actions (Same Day)**
**When to act:** Critical issues detected

**Examples:**
- 🚨 DAU dropped 50%+ → Check for crashes, server issues
- 🚨 Completion rate < 10% → Check for game-breaking bugs
- 🚨 Revenue = $0 when normally $100+ → Check payment system

**Action:** Investigate immediately, fix if broken

---

### **Quick Wins (Within 1 Week)**
**When to act:** Clear negative trends (3+ days)

**Examples:**
- 📉 D1 Retention dropped from 40% → 30% → Check recent changes
- 📉 ARPU declining → Test new monetization features
- 📉 Level 5 completion rate < 20% → Make level easier

**Action:** A/B test fixes, monitor for 1 week

---

### **Strategic Changes (2-4 Weeks)**
**When to act:** Sustained patterns, statistical significance

**Examples:**
- 📊 Campaign ROI consistently negative → Pause campaign
- 📊 LTV declining over 2 weeks → Review monetization strategy
- 📊 Churn rate increasing → Plan retention features

**Action:** Plan changes, implement, measure impact

---

### **Long-Term Planning (Monthly+)**
**When to act:** Quarterly reviews, major feature launches

**Examples:**
- 📈 Growth plateauing → Plan new acquisition channels
- 📈 Retention stable but low → Plan major retention features
- 📈 Revenue growth slowing → Plan new monetization features

**Action:** Strategic planning, roadmap decisions

---

## 📊 What Metrics Matter When?

### **Hourly (If Monitoring Launch)**
- DAU (during launch events)
- Crash rate
- Server errors

**Only during:** Major launches, critical issues

---

### **Daily**
- DAU vs. yesterday
- Games started/ended
- Revenue (today)
- Completion rate

**Purpose:** Health monitoring

---

### **Weekly**
- DAU trend (7 days)
- D1/D7 Retention
- Revenue trend
- Campaign ROI (if running ads)
- Level difficulty analysis

**Purpose:** Trend identification, quick optimizations

---

### **Monthly**
- Cohort analysis
- LTV trends
- Campaign performance
- Feature impact analysis
- Growth trajectory

**Purpose:** Strategic decisions, major changes

---

## 🎯 Recommended Workflow

### **Monday Morning (15 min)**
1. Check DAU vs. last week
2. Review revenue trend
3. Check for any red flags
4. **Action:** Note any issues to investigate

### **Wednesday Mid-Week (10 min)**
1. Quick health check
2. Verify Monday's issues resolved
3. **Action:** Continue monitoring

### **Friday Afternoon (30 min)**
1. Weekly deep dive
2. Review all trends
3. Check campaign ROI (if applicable)
4. **Action:** Plan next week's optimizations

### **First Monday of Month (1-2 hours)**
1. Monthly review
2. Cohort analysis
3. Strategic planning
4. **Action:** Major decisions, roadmap updates

---

## ⚠️ When NOT to Make Decisions

### **Don't React to:**
- ❌ Single-day anomalies (could be normal variance)
- ❌ Hourly fluctuations (too noisy)
- ❌ < 100 users in sample (not statistically significant)
- ❌ Weekend vs. weekday differences (expected)

### **Wait for:**
- ✅ 3+ days of consistent trend
- ✅ 100+ users in cohort
- ✅ Statistical significance (use confidence intervals)
- ✅ Context (holidays, launches, etc.)

---

## 📈 Sample Decision Framework

### **Scenario: D1 Retention Dropped**

**Day 1:** 
- ✅ Check: Is it a one-day blip? (Wait)

**Day 2:**
- ✅ Check: Still low? (Monitor closely)

**Day 3:**
- ✅ Check: Sustained drop? (Investigate)
- ✅ Action: Check what changed 3 days ago

**Day 4-7:**
- ✅ Action: Implement fix
- ✅ Monitor: Does it recover?

**Week 2:**
- ✅ Decision: If still low, make bigger changes

---

## 💡 Pro Tips

1. **Set Alerts:** Configure alerts for critical metrics (DAU drop >30%, crash rate spike)
2. **Baseline First:** Understand your normal patterns before reacting
3. **Context Matters:** Check for holidays, launches, external events
4. **Cohort Size:** Wait for meaningful sample sizes (100+ users)
5. **Compare Periods:** Always compare to same day last week/month

---

## 🎯 Quick Reference

| Metric | Check Frequency | Decision Timeline | Sample Size Needed |
|--------|----------------|------------------|-------------------|
| DAU | Daily | Same day (if >30% drop) | 100+ users |
| Revenue | Daily | 3 days trend | $100+ revenue |
| Retention (D1) | Weekly | 1 week | 100+ users |
| Retention (D7) | Weekly | 2 weeks | 50+ users |
| LTV | Monthly | 1 month | 200+ users |
| Campaign ROI | Weekly | 1 week | $500+ spend |
| Level Difficulty | Weekly | 1 week | 50+ attempts |

---

## 🚀 Bottom Line

**Daily:** Health check (5 min) - catch fires early  
**Weekly:** Strategic review (30 min) - make optimizations  
**Monthly:** Deep analysis (1-2 hours) - major decisions  

**Remember:** Data needs time to be meaningful. Don't overreact to daily noise! 📊

