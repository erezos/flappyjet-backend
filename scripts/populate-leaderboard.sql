-- Populate leaderboard with existing player data
-- This script ensures all players have proper best_score values

-- Update players table to ensure player_name is set from nickname
UPDATE players 
SET player_name = nickname 
WHERE player_name IS NULL OR player_name = '';

-- Update players table to ensure player_id is set from id
UPDATE players 
SET player_id = id 
WHERE player_id IS NULL;

-- Create some sample scores if no game_sessions exist
-- This helps populate the leaderboard for testing
INSERT INTO game_sessions (player_id, player_name, score, jet_skin, theme, game_data)
SELECT 
    id as player_id,
    nickname as player_name,
    CASE 
        WHEN best_score > 0 THEN best_score
        ELSE FLOOR(RANDOM() * 50 + 1)::INTEGER  -- Random score 1-50 for testing
    END as score,
    'sky_jet' as jet_skin,
    'sky' as theme,
    '{}' as game_data
FROM players 
WHERE NOT EXISTS (
    SELECT 1 FROM game_sessions WHERE game_sessions.player_id = players.id
)
AND NOT is_banned;

-- Update players best_score from their highest game_session score
UPDATE players 
SET best_score = COALESCE(
    (SELECT MAX(score) FROM game_sessions WHERE game_sessions.player_id = players.id),
    0
),
total_games = COALESCE(
    (SELECT COUNT(*) FROM game_sessions WHERE game_sessions.player_id = players.id),
    0
)
WHERE EXISTS (SELECT 1 FROM game_sessions WHERE game_sessions.player_id = players.id);

-- Show results
SELECT 
    'Players with scores' as description,
    COUNT(*) as count
FROM players 
WHERE best_score > 0;

SELECT 
    'Game sessions' as description,
    COUNT(*) as count
FROM game_sessions;

SELECT 
    'Top 10 players' as description,
    player_name,
    best_score,
    total_games
FROM players 
WHERE best_score > 0
ORDER BY best_score DESC, updated_at ASC
LIMIT 10;
