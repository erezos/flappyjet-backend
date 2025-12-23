-- ============================================================================
-- MIGRATION 025 - PART 4: Create indexes on partitioned table
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_partitioned_received ON events_partitioned(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_partitioned_type ON events_partitioned(event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_partitioned_user ON events_partitioned(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_partitioned_campaign_received ON events_partitioned(campaign_id, received_at DESC) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_partitioned_type_received_campaign ON events_partitioned(event_type, received_at DESC, campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_partitioned_payload ON events_partitioned USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_partitioned_type_unprocessed ON events_partitioned(event_type, received_at DESC) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_partitioned_tournament ON events_partitioned(event_type, received_at, processed_at) WHERE event_type = 'game_ended';

SELECT 'Part 4 completed: Indexes created' AS status;

