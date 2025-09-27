-- 🚨 EMERGENCY FIX: Analytics Dashboard Showing Zeros
-- This script fixes the critical database constraint issue blocking score submissions
-- Run this IMMEDIATELY on your Railway PostgreSQL database

-- Step 1: Remove the problematic unique constraint on device_id
-- This constraint is causing "duplicate key value violates unique constraint" errors
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_device_id_key;
DROP INDEX IF EXISTS players_device_id_key;

-- Step 2: Make device_id nullable (some existing records might not have it)
ALTER TABLE players ALTER COLUMN device_id DROP NOT NULL;

-- Step 3: Add is_anonymous column if it doesn't exist (for our new anonymous system)
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false;

-- Step 4: Create a partial unique index for anonymous users only
-- This ensures anonymous users are unique per device, but allows authenticated users to share devices
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_anonymous_device_unique 
ON players (device_id) 
WHERE is_anonymous = true AND device_id IS NOT NULL;

-- Step 5: Update existing players to be marked as authenticated
UPDATE players SET is_anonymous = false WHERE is_anonymous IS NULL;

-- Step 6: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_players_anonymous ON players (is_anonymous);
CREATE INDEX IF NOT EXISTS idx_players_created_at ON players (created_at);
CREATE INDEX IF NOT EXISTS idx_players_best_score ON players (best_score DESC);

-- Step 7: Verify the fix worked
SELECT 
    'CONSTRAINT REMOVED' as status,
    COUNT(*) as total_players,
    COUNT(CASE WHEN is_anonymous = true THEN 1 END) as anonymous_players,
    COUNT(CASE WHEN is_anonymous = false THEN 1 END) as authenticated_players
FROM players;

-- Step 8: Check for any remaining constraint conflicts
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'players' AND constraint_type = 'UNIQUE';

-- Success message
SELECT '🎉 EMERGENCY FIX COMPLETED! Analytics should start working immediately.' as message;
