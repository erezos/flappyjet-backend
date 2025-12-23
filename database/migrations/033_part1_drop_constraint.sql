-- ============================================================================
-- MIGRATION 033 - PART 1: Drop existing constraint
-- Purpose: Safely drop the valid_event_type constraint
-- Date: 2025-12-23
-- ============================================================================

-- Drop the existing constraint from parent table
-- This will automatically drop from all partitions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_event_type' 
    AND conrelid = 'events'::regclass
  ) THEN
    ALTER TABLE events DROP CONSTRAINT valid_event_type;
    RAISE NOTICE '✅ Dropped existing valid_event_type constraint from parent and all partitions';
  ELSE
    RAISE NOTICE 'ℹ️  Constraint valid_event_type does not exist (already dropped or never created)';
  END IF;
END $$;

