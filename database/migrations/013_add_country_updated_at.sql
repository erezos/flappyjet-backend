-- Migration: Add country_updated_at column to users table
-- This tracks when the user's country was last detected via IP geolocation
-- Used to refresh country data periodically (e.g., weekly)

-- Add country_updated_at column if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS country_updated_at TIMESTAMP;

-- Set initial value for existing rows
UPDATE users 
SET country_updated_at = created_at 
WHERE country IS NOT NULL AND country_updated_at IS NULL;

-- Create index for querying users by country update time
CREATE INDEX IF NOT EXISTS idx_users_country_updated_at ON users(country_updated_at);

-- Log migration
DO $$ 
BEGIN
  RAISE NOTICE '✅ Added country_updated_at column to users table';
END $$;

