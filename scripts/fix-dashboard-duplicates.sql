-- Fix Dashboard Duplicate Rows Issue
-- This script fixes the duplicate rows problem in materialized views

-- Step 1: Drop and recreate the problematic materialized view
DROP MATERIALIZED VIEW IF EXISTS daily_kpi_summary CASCADE;

-- Step 2: Recreate the view with proper deduplication
CREATE MATERIALIZED VIEW daily_kpi_summary AS
SELECT 
    date,
    COALESCE(SUM(daily_active_users), 0) as daily_active_users,
    COALESCE(SUM(gaming_users), 0) as gaming_users,
    COALESCE(SUM(android_users), 0) as android_users,
    COALESCE(SUM(ios_users), 0) as ios_users,
    COALESCE(SUM(daily_revenue), 0) as daily_revenue_usd,
    COALESCE(SUM(paying_users), 0) as paying_users,
    COALESCE(SUM(total_purchases), 0) as total_purchases,
    COALESCE(SUM(total_sessions), 0) as total_sessions,
    COALESCE(AVG(avg_sessions_per_user), 0) as avg_sessions_per_user,
    COALESCE(AVG(completion_rate_percent), 0) as completion_rate_percent,
    COALESCE(SUM(total_crashes), 0) as total_crashes,
    COALESCE(AVG(crash_rate_percent), 0) as crash_rate_percent,
    COALESCE(AVG(ad_conversion_rate), 0) as ad_conversion_rate,
    COALESCE(AVG(iap_conversion_rate), 0) as iap_conversion_rate,
    COALESCE(AVG(arpu), 0) as arpu,
    COALESCE(AVG(arppu), 0) as arppu,
    COALESCE(AVG(day1_retention_rate), 0) as day1_retention_rate,
    COALESCE(AVG(day7_retention_rate), 0) as day7_retention_rate,
    COALESCE(AVG(day30_retention_rate), 0) as day30_retention_rate
FROM (
    -- Deduplicate by taking the latest record for each date
    SELECT DISTINCT ON (date)
        date,
        daily_active_users,
        gaming_users,
        android_users,
        ios_users,
        daily_revenue,
        paying_users,
        total_purchases,
        total_sessions,
        avg_sessions_per_user,
        completion_rate_percent,
        total_crashes,
        crash_rate_percent,
        ad_conversion_rate,
        iap_conversion_rate,
        arpu,
        arppu,
        day1_retention_rate,
        day7_retention_rate,
        day30_retention_rate
    FROM (
        -- Union all the individual view data
        SELECT 
            date,
            daily_active_users,
            gaming_users,
            android_users,
            ios_users,
            0 as daily_revenue,
            0 as paying_users,
            0 as total_purchases,
            0 as total_sessions,
            0 as avg_sessions_per_user,
            0 as completion_rate_percent,
            0 as total_crashes,
            0 as crash_rate_percent,
            0 as ad_conversion_rate,
            0 as iap_conversion_rate,
            0 as arpu,
            0 as arppu,
            0 as day1_retention_rate,
            0 as day7_retention_rate,
            0 as day30_retention_rate
        FROM daily_active_users
        WHERE date >= CURRENT_DATE - INTERVAL '90 days'
        
        UNION ALL
        
        SELECT 
            date,
            0 as daily_active_users,
            0 as gaming_users,
            0 as android_users,
            0 as ios_users,
            daily_revenue,
            0 as paying_users,
            0 as total_purchases,
            0 as total_sessions,
            0 as avg_sessions_per_user,
            0 as completion_rate_percent,
            0 as total_crashes,
            0 as crash_rate_percent,
            0 as ad_conversion_rate,
            0 as iap_conversion_rate,
            0 as arpu,
            0 as arppu,
            0 as day1_retention_rate,
            0 as day7_retention_rate,
            0 as day30_retention_rate
        FROM daily_revenue
        WHERE date >= CURRENT_DATE - INTERVAL '90 days'
        
        UNION ALL
        
        SELECT 
            date,
            0 as daily_active_users,
            0 as gaming_users,
            0 as android_users,
            0 as ios_users,
            0 as daily_revenue,
            paying_users,
            total_purchases,
            total_sessions,
            avg_sessions_per_user,
            completion_rate_percent,
            0 as total_crashes,
            0 as crash_rate_percent,
            ad_conversion_rate,
            iap_conversion_rate,
            arpu,
            arppu,
            0 as day1_retention_rate,
            0 as day7_retention_rate,
            0 as day30_retention_rate
        FROM daily_engagement
        WHERE date >= CURRENT_DATE - INTERVAL '90 days'
        
        UNION ALL
        
        SELECT 
            date,
            0 as daily_active_users,
            0 as gaming_users,
            0 as android_users,
            0 as ios_users,
            0 as daily_revenue,
            0 as paying_users,
            0 as total_purchases,
            0 as total_sessions,
            0 as avg_sessions_per_user,
            0 as completion_rate_percent,
            total_crashes,
            crash_rate_percent,
            0 as ad_conversion_rate,
            0 as iap_conversion_rate,
            0 as arpu,
            0 as arppu,
            0 as day1_retention_rate,
            0 as day7_retention_rate,
            0 as day30_retention_rate
        FROM daily_crashes
        WHERE date >= CURRENT_DATE - INTERVAL '90 days'
        
        UNION ALL
        
        SELECT 
            date,
            0 as daily_active_users,
            0 as gaming_users,
            0 as android_users,
            0 as ios_users,
            0 as daily_revenue,
            0 as paying_users,
            0 as total_purchases,
            0 as total_sessions,
            0 as avg_sessions_per_user,
            0 as completion_rate_percent,
            0 as total_crashes,
            0 as crash_rate_percent,
            0 as ad_conversion_rate,
            0 as iap_conversion_rate,
            0 as arpu,
            0 as arppu,
            day1_retention_rate,
            day7_retention_rate,
            day30_retention_rate
        FROM retention_cohorts
        WHERE date >= CURRENT_DATE - INTERVAL '90 days'
    ) combined_data
    ORDER BY date DESC, daily_active_users DESC
) deduplicated_data
GROUP BY date
ORDER BY date DESC;

-- Step 3: Create unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_kpi_summary_date_unique 
ON daily_kpi_summary (date);

-- Step 4: Refresh the view
REFRESH MATERIALIZED VIEW daily_kpi_summary;

-- Step 5: Update the refresh function to handle duplicates better
CREATE OR REPLACE FUNCTION refresh_daily_kpi_views()
RETURNS void AS $$
BEGIN
    -- Refresh all materialized views
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_active_users;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_engagement;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_crashes;
    REFRESH MATERIALIZED VIEW CONCURRENTLY retention_cohorts;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_monetization_funnel;
    
    -- Refresh the summary view (this might fail if there are still duplicates)
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY daily_kpi_summary;
    EXCEPTION WHEN OTHERS THEN
        -- If refresh fails due to duplicates, recreate the view
        DROP MATERIALIZED VIEW IF EXISTS daily_kpi_summary CASCADE;
        
        -- Recreate with current data
        CREATE MATERIALIZED VIEW daily_kpi_summary AS
        SELECT 
            date,
            COALESCE(SUM(daily_active_users), 0) as daily_active_users,
            COALESCE(SUM(gaming_users), 0) as gaming_users,
            COALESCE(SUM(android_users), 0) as android_users,
            COALESCE(SUM(ios_users), 0) as ios_users,
            COALESCE(SUM(daily_revenue), 0) as daily_revenue_usd,
            COALESCE(SUM(paying_users), 0) as paying_users,
            COALESCE(SUM(total_purchases), 0) as total_purchases,
            COALESCE(SUM(total_sessions), 0) as total_sessions,
            COALESCE(AVG(avg_sessions_per_user), 0) as avg_sessions_per_user,
            COALESCE(AVG(completion_rate_percent), 0) as completion_rate_percent,
            COALESCE(SUM(total_crashes), 0) as total_crashes,
            COALESCE(AVG(crash_rate_percent), 0) as crash_rate_percent,
            COALESCE(AVG(ad_conversion_rate), 0) as ad_conversion_rate,
            COALESCE(AVG(iap_conversion_rate), 0) as iap_conversion_rate,
            COALESCE(AVG(arpu), 0) as arpu,
            COALESCE(AVG(arppu), 0) as arppu,
            COALESCE(AVG(day1_retention_rate), 0) as day1_retention_rate,
            COALESCE(AVG(day7_retention_rate), 0) as day7_retention_rate,
            COALESCE(AVG(day30_retention_rate), 0) as day30_retention_rate
        FROM (
            SELECT DISTINCT ON (date)
                date,
                daily_active_users,
                gaming_users,
                android_users,
                ios_users,
                daily_revenue,
                paying_users,
                total_purchases,
                total_sessions,
                avg_sessions_per_user,
                completion_rate_percent,
                total_crashes,
                crash_rate_percent,
                ad_conversion_rate,
                iap_conversion_rate,
                arpu,
                arppu,
                day1_retention_rate,
                day7_retention_rate,
                day30_retention_rate
            FROM (
                SELECT date, daily_active_users, gaming_users, android_users, ios_users, 0 as daily_revenue, 0 as paying_users, 0 as total_purchases, 0 as total_sessions, 0 as avg_sessions_per_user, 0 as completion_rate_percent, 0 as total_crashes, 0 as crash_rate_percent, 0 as ad_conversion_rate, 0 as iap_conversion_rate, 0 as arpu, 0 as arppu, 0 as day1_retention_rate, 0 as day7_retention_rate, 0 as day30_retention_rate FROM daily_active_users WHERE date >= CURRENT_DATE - INTERVAL '90 days'
                UNION ALL
                SELECT date, 0, 0, 0, 0, daily_revenue, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 FROM daily_revenue WHERE date >= CURRENT_DATE - INTERVAL '90 days'
                UNION ALL
                SELECT date, 0, 0, 0, 0, 0, paying_users, total_purchases, total_sessions, avg_sessions_per_user, completion_rate_percent, 0, 0, ad_conversion_rate, iap_conversion_rate, arpu, arppu, 0, 0, 0 FROM daily_engagement WHERE date >= CURRENT_DATE - INTERVAL '90 days'
                UNION ALL
                SELECT date, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, total_crashes, crash_rate_percent, 0, 0, 0, 0, 0, 0, 0 FROM daily_crashes WHERE date >= CURRENT_DATE - INTERVAL '90 days'
                UNION ALL
                SELECT date, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, day1_retention_rate, day7_retention_rate, day30_retention_rate FROM retention_cohorts WHERE date >= CURRENT_DATE - INTERVAL '90 days'
            ) combined_data
            ORDER BY date DESC, daily_active_users DESC
        ) deduplicated_data
        GROUP BY date
        ORDER BY date DESC;
        
        -- Recreate the unique index
        CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_kpi_summary_date_unique 
        ON daily_kpi_summary (date);
    END;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Test the refresh
SELECT refresh_daily_kpi_views();

-- Step 7: Check the results
SELECT 
    date,
    daily_active_users,
    daily_revenue_usd,
    total_purchases
FROM daily_kpi_summary 
ORDER BY date DESC 
LIMIT 10;
