-- 📊 Analytics Schema Fixes for FlappyJet Railway Backend
-- This script fixes the missing columns and tables causing analytics failures

-- Fix analytics_events table - add missing columns
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(50);
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at);

-- Create daily_streaks table for notifications system
CREATE TABLE IF NOT EXISTS daily_streaks (
    player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0,
    last_claim_date DATE DEFAULT CURRENT_DATE,
    max_streak INTEGER DEFAULT 0,
    total_claims INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for daily_streaks
CREATE INDEX IF NOT EXISTS idx_daily_streaks_last_claim_date ON daily_streaks(last_claim_date);
CREATE INDEX IF NOT EXISTS idx_daily_streaks_current_streak ON daily_streaks(current_streak);

-- Update analytics_events table to match the expected schema
-- Add event_category if it doesn't exist (it should from the routes file)
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS event_category VARCHAR(50) DEFAULT 'other';

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for daily_streaks
DROP TRIGGER IF EXISTS update_daily_streaks_updated_at ON daily_streaks;
CREATE TRIGGER update_daily_streaks_updated_at
    BEFORE UPDATE ON daily_streaks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Verify the schema changes
SELECT 
    column_name, 
    data_type, 
    is_nullable 
FROM information_schema.columns 
WHERE table_name = 'analytics_events' 
ORDER BY ordinal_position;

SELECT 
    column_name, 
    data_type, 
    is_nullable 
FROM information_schema.columns 
WHERE table_name = 'daily_streaks' 
ORDER BY ordinal_position;

-- Show current analytics events count
SELECT COUNT(*) as total_analytics_events FROM analytics_events;

COMMIT;

