-- 🔄 Add Auto-Refill Booster Support
-- Migration to add auto-refill functionality for FTUE enhancement

-- Add auto_refill_expiry to players table
ALTER TABLE players 
ADD COLUMN auto_refill_expiry TIMESTAMP WITH TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN players.auto_refill_expiry IS 'When auto-refill booster expires. Hearts automatically refill to max when returning to menu while active.';

-- Create index for efficient auto-refill queries
CREATE INDEX idx_players_auto_refill_active 
ON players (auto_refill_expiry) 
WHERE auto_refill_expiry IS NOT NULL AND auto_refill_expiry > NOW();

-- Update the constraint to allow for auto-refill logic
-- (No changes needed to existing constraints)

-- Add auto-refill analytics event type
INSERT INTO analytics_events (event_type, description) 
VALUES 
    ('auto_refill_activated', 'Player activated auto-refill booster'),
    ('auto_refill_triggered', 'Auto-refill automatically filled hearts'),
    ('auto_refill_expired', 'Auto-refill booster expired')
ON CONFLICT (event_type) DO NOTHING;
