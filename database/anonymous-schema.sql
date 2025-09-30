-- 🎭 Anonymous Player Support Schema
-- Adds tables to support anonymous players and account linking

-- Table to link anonymous IDs to cloud accounts
CREATE TABLE IF NOT EXISTS anonymous_links (
    id SERIAL PRIMARY KEY,
    anonymous_id VARCHAR(255) UNIQUE NOT NULL,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    linked_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast anonymous ID lookups
CREATE INDEX IF NOT EXISTS idx_anonymous_links_anonymous_id ON anonymous_links(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_anonymous_links_player_id ON anonymous_links(player_id);

-- Table for temporary anonymous scores (before linking)
CREATE TABLE IF NOT EXISTS anonymous_scores (
    anonymous_id VARCHAR(255) PRIMARY KEY,
    score INTEGER NOT NULL DEFAULT 0,
    survival_time INTEGER NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for anonymous score queries
CREATE INDEX IF NOT EXISTS idx_anonymous_scores_score ON anonymous_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_anonymous_scores_submitted_at ON anonymous_scores(submitted_at DESC);

-- Add anonymous tracking to existing tables
ALTER TABLE players ADD COLUMN IF NOT EXISTS anonymous_origin BOOLEAN DEFAULT FALSE;
ALTER TABLE players ADD COLUMN IF NOT EXISTS anonymous_linked_at TIMESTAMP;

-- Add master ID support for data recovery
ALTER TABLE players ADD COLUMN IF NOT EXISTS master_id VARCHAR(255) UNIQUE;

-- Add index for master ID lookups
CREATE INDEX IF NOT EXISTS idx_players_master_id ON players(master_id);

-- Update existing auth analytics to track anonymous users
ALTER TABLE auth_events ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;

-- View for anonymous leaderboard (public data only)
CREATE OR REPLACE VIEW anonymous_leaderboard AS
SELECT 
    ROW_NUMBER() OVER (ORDER BY score DESC, submitted_at ASC) as rank,
    'Anonymous' as nickname,
    score,
    'unknown' as platform,
    'XX' as country_code,
    submitted_at
FROM anonymous_scores 
WHERE score > 0
ORDER BY score DESC, submitted_at ASC
LIMIT 100;

-- Function to clean up old anonymous scores (run periodically)
CREATE OR REPLACE FUNCTION cleanup_anonymous_scores()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete anonymous scores older than 30 days that haven't been linked
    DELETE FROM anonymous_scores 
    WHERE submitted_at < NOW() - INTERVAL '30 days'
    AND anonymous_id NOT IN (SELECT anonymous_id FROM anonymous_links);
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to merge anonymous data when linking account
CREATE OR REPLACE FUNCTION merge_anonymous_data(
    p_anonymous_id VARCHAR(255),
    p_player_id INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    anonymous_score_record RECORD;
    merge_success BOOLEAN DEFAULT TRUE;
BEGIN
    -- Get anonymous score data
    SELECT * INTO anonymous_score_record 
    FROM anonymous_scores 
    WHERE anonymous_id = p_anonymous_id;
    
    IF FOUND THEN
        -- Update player with anonymous data if it's better
        UPDATE players 
        SET 
            best_score = GREATEST(best_score, anonymous_score_record.score),
            anonymous_origin = TRUE,
            anonymous_linked_at = NOW()
        WHERE id = p_player_id;
        
        -- Clean up anonymous score record
        DELETE FROM anonymous_scores WHERE anonymous_id = p_anonymous_id;
        
        -- Log the merge
        INSERT INTO auth_events (event_type, player_id, details, created_at)
        VALUES (
            'anonymous_merge', 
            p_player_id, 
            jsonb_build_object(
                'anonymous_id', p_anonymous_id,
                'merged_score', anonymous_score_record.score,
                'merged_survival_time', anonymous_score_record.survival_time
            ),
            NOW()
        );
    END IF;
    
    RETURN merge_success;
EXCEPTION
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE anonymous_links IS 'Links anonymous player IDs to cloud accounts';
COMMENT ON TABLE anonymous_scores IS 'Temporary storage for anonymous player scores before account linking';
COMMENT ON FUNCTION cleanup_anonymous_scores() IS 'Cleans up old anonymous scores that were never linked';
COMMENT ON FUNCTION merge_anonymous_data(VARCHAR, INTEGER) IS 'Merges anonymous player data when linking to cloud account';

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON anonymous_links TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON anonymous_scores TO your_app_user;
-- GRANT USAGE ON SEQUENCE anonymous_links_id_seq TO your_app_user;
