-- Migration: Create users table for lightweight auth
-- This table stores device-based user identities
-- No passwords, no sessions - just device tracking

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  nickname VARCHAR(100) DEFAULT 'Player',
  country VARCHAR(2),
  device_model VARCHAR(255),
  os_version VARCHAR(100),
  app_version VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT users_user_id_key UNIQUE (user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

-- Log migration
DO $$ 
BEGIN
  RAISE NOTICE '✅ Users table created successfully';
END $$;

