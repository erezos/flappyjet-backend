-- ============================================================================
-- MIGRATION 019 - PART 2: INDEXES ONLY
-- Run this after part 1
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_type_unprocessed ON events(event_type, received_at DESC) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events(processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_payload ON events USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_tournament ON events(event_type, received_at, processed_at) WHERE event_type = 'game_ended';
CREATE INDEX IF NOT EXISTS idx_events_campaign_timestamp ON events(campaign_id, received_at DESC) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_type_received_campaign ON events(event_type, received_at DESC, campaign_id) WHERE campaign_id IS NOT NULL;

SELECT 'Part 2 completed: Indexes added' AS status;

