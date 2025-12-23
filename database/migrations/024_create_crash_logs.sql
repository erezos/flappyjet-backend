-- ============================================================================
-- MIGRATION: 024_create_crash_logs.sql
-- Purpose: Create crash_logs table for crash and error tracking
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Crash Logs Table
-- Stores crash and error data from Flutter app
CREATE TABLE IF NOT EXISTS crash_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Crash/Error Details
  crash_type VARCHAR(100) NOT NULL, -- 'fatal', 'error', 'exception'
  crash_message TEXT NOT NULL,
  stack_trace TEXT,
  context VARCHAR(255), -- Where the crash occurred (e.g., 'game_play', 'menu', 'loading')
  
  -- Device Info
  device_model VARCHAR(255),
  os_version VARCHAR(100),
  platform VARCHAR(10),
  app_version VARCHAR(50),
  
  -- Severity
  fatal BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_platform CHECK (platform IS NULL OR platform IN ('ios', 'android')),
  CONSTRAINT valid_crash_type CHECK (crash_type IN ('fatal', 'error', 'exception', 'crash'))
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index: Time-based queries (most common)
CREATE INDEX IF NOT EXISTS idx_crash_logs_timestamp 
  ON crash_logs(timestamp DESC);

-- Index: Crash type analysis
CREATE INDEX IF NOT EXISTS idx_crash_logs_crash_type 
  ON crash_logs(crash_type, timestamp DESC);

-- Index: User crash history
CREATE INDEX IF NOT EXISTS idx_crash_logs_user_timestamp 
  ON crash_logs(user_id, timestamp DESC);

-- Index: Fatal crashes (for alerting)
CREATE INDEX IF NOT EXISTS idx_crash_logs_fatal 
  ON crash_logs(fatal, timestamp DESC) 
  WHERE fatal = true;

-- Index: Context analysis (where crashes occur)
CREATE INDEX IF NOT EXISTS idx_crash_logs_context 
  ON crash_logs(context, timestamp DESC) 
  WHERE context IS NOT NULL;

-- Index: Device/OS analysis
CREATE INDEX IF NOT EXISTS idx_crash_logs_device 
  ON crash_logs(device_model, os_version, timestamp DESC) 
  WHERE device_model IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE crash_logs IS 'Crash and error logs from Flutter app';
COMMENT ON COLUMN crash_logs.crash_type IS 'Type of crash: fatal, error, exception, crash';
COMMENT ON COLUMN crash_logs.crash_message IS 'Error message or exception description';
COMMENT ON COLUMN crash_logs.stack_trace IS 'Full stack trace (if available)';
COMMENT ON COLUMN crash_logs.context IS 'Where the crash occurred (game_play, menu, loading, etc.)';
COMMENT ON COLUMN crash_logs.fatal IS 'Whether this is a fatal crash (app terminated)';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crash_logs') THEN
    RAISE EXCEPTION 'Migration failed: crash_logs table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_crash_logs_timestamp') THEN
    RAISE EXCEPTION 'Migration failed: idx_crash_logs_timestamp index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 024_create_crash_logs.sql completed successfully';
END $$;

