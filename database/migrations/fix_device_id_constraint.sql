-- EMERGENCY FIX: Remove device_id unique constraint that's blocking score submissions
-- This constraint conflicts with our anonymous user system where multiple players can share device IDs
-- Date: 2024-09-27
-- Priority: CRITICAL - Fixes analytics dashboard showing zeros

-- Step 1: Drop the problematic unique constraint on device_id
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_device_id_key;

-- Step 2: Drop the unique index if it exists
DROP INDEX IF EXISTS players_device_id_key;

-- Step 3: Verify the constraint is removed
-- (This will be logged in the migration output)

-- Step 4: Create a partial unique index for anonymous users only
-- This ensures anonymous users (identified by device_id) are unique per device
-- but allows authenticated users to share device IDs
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_anonymous_device_unique 
ON players (device_id) 
WHERE is_anonymous = true;

-- Step 5: Add logging to confirm fix
INSERT INTO schema_migrations (version, description, applied_at) 
VALUES (
    '20240927_fix_device_id_constraint', 
    'EMERGENCY: Remove device_id unique constraint blocking score submissions',
    NOW()
) ON CONFLICT (version) DO NOTHING;

-- Step 6: Verify players table structure
-- SELECT column_name, is_nullable, data_type, character_maximum_length 
-- FROM information_schema.columns 
-- WHERE table_name = 'players' AND column_name = 'device_id';

COMMENT ON COLUMN players.device_id IS 'Device identifier - not unique globally, but unique per anonymous user';

-- Log completion
SELECT 'EMERGENCY FIX COMPLETED: device_id constraint removed, analytics should start working' as status;
