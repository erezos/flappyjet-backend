-- ============================================================================
-- MIGRATION: 023_create_performance_metrics.sql
-- Purpose: Create performance_metrics table for FPS, load times, memory usage
-- Date: 2025-01-20
-- Author: FlappyJet Analytics Team
-- ============================================================================

-- Performance Metrics Table
-- Stores performance data from Flutter app (FPS, load times, memory)
CREATE TABLE IF NOT EXISTS performance_metrics (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- FPS Metrics
  fps_average DECIMAL(5,2),
  fps_min DECIMAL(5,2),
  fps_max DECIMAL(5,2),
  fps_current DECIMAL(5,2),
  
  -- Load Times
  app_load_time_ms INTEGER,
  game_load_time_ms INTEGER,
  
  -- Memory Usage
  memory_mb DECIMAL(10,2),
  
  -- Frame Timing
  frame_time_ms DECIMAL(10,2),
  
  -- Device Info
  device_model VARCHAR(255),
  os_version VARCHAR(100),
  platform VARCHAR(10),
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_fps CHECK (fps_average IS NULL OR (fps_average >= 0 AND fps_average <= 120)),
  CONSTRAINT valid_platform CHECK (platform IS NULL OR platform IN ('ios', 'android'))
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index: Time-based queries (most common)
CREATE INDEX IF NOT EXISTS idx_performance_metrics_timestamp 
  ON performance_metrics(timestamp DESC);

-- Index: User performance history
CREATE INDEX IF NOT EXISTS idx_performance_metrics_user_timestamp 
  ON performance_metrics(user_id, timestamp DESC);

-- Index: FPS analysis queries
CREATE INDEX IF NOT EXISTS idx_performance_metrics_fps 
  ON performance_metrics(fps_average, timestamp DESC) 
  WHERE fps_average IS NOT NULL;

-- Index: Load time analysis
CREATE INDEX IF NOT EXISTS idx_performance_metrics_load_time 
  ON performance_metrics(app_load_time_ms, game_load_time_ms, timestamp DESC) 
  WHERE app_load_time_ms IS NOT NULL OR game_load_time_ms IS NOT NULL;

-- Index: Device/OS analysis
CREATE INDEX IF NOT EXISTS idx_performance_metrics_device 
  ON performance_metrics(device_model, os_version, timestamp DESC) 
  WHERE device_model IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE performance_metrics IS 'Performance metrics from Flutter app (FPS, load times, memory)';
COMMENT ON COLUMN performance_metrics.fps_average IS 'Average FPS over reporting period (typically 30 seconds)';
COMMENT ON COLUMN performance_metrics.fps_min IS 'Minimum FPS during reporting period';
COMMENT ON COLUMN performance_metrics.fps_max IS 'Maximum FPS during reporting period';
COMMENT ON COLUMN performance_metrics.app_load_time_ms IS 'App initialization time in milliseconds';
COMMENT ON COLUMN performance_metrics.game_load_time_ms IS 'Game scene load time in milliseconds';

-- ============================================================================
-- VERIFY MIGRATION
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'performance_metrics') THEN
    RAISE EXCEPTION 'Migration failed: performance_metrics table not created';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_timestamp') THEN
    RAISE EXCEPTION 'Migration failed: idx_performance_metrics_timestamp index not created';
  END IF;
  
  RAISE NOTICE '✅ Migration 023_create_performance_metrics.sql completed successfully';
END $$;

