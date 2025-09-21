-- 🎯 Enhanced Daily Streak Schema for FlappyJet Railway Backend
-- This script adds cycle management and analytics to the daily streak system

-- 1. Enhance existing daily_streaks table with cycle tracking
ALTER TABLE daily_streaks ADD COLUMN IF NOT EXISTS current_cycle INTEGER DEFAULT 0;
ALTER TABLE daily_streaks ADD COLUMN IF NOT EXISTS cycle_start_date DATE;
ALTER TABLE daily_streaks ADD COLUMN IF NOT EXISTS last_cycle_completion_date DATE;
ALTER TABLE daily_streaks ADD COLUMN IF NOT EXISTS total_cycles_completed INTEGER DEFAULT 0;
ALTER TABLE daily_streaks ADD COLUMN IF NOT EXISTS cycle_reward_set VARCHAR(20) DEFAULT 'new_player';

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_streaks_current_cycle ON daily_streaks(current_cycle);
CREATE INDEX IF NOT EXISTS idx_daily_streaks_cycle_start_date ON daily_streaks(cycle_start_date);
CREATE INDEX IF NOT EXISTS idx_daily_streaks_last_cycle_completion ON daily_streaks(last_cycle_completion_date);
CREATE INDEX IF NOT EXISTS idx_daily_streaks_cycle_reward_set ON daily_streaks(cycle_reward_set);

-- 3. Create cycle analytics table for detailed tracking
CREATE TABLE IF NOT EXISTS daily_streak_cycles (
    id SERIAL PRIMARY KEY,
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    start_date DATE NOT NULL,
    completion_date DATE,
    rewards_claimed JSONB DEFAULT '[]',
    reward_set VARCHAR(20) NOT NULL DEFAULT 'new_player',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. Create indexes for cycle analytics
CREATE INDEX IF NOT EXISTS idx_daily_streak_cycles_player_id ON daily_streak_cycles(player_id);
CREATE INDEX IF NOT EXISTS idx_daily_streak_cycles_cycle_number ON daily_streak_cycles(cycle_number);
CREATE INDEX IF NOT EXISTS idx_daily_streak_cycles_start_date ON daily_streak_cycles(start_date);
CREATE INDEX IF NOT EXISTS idx_daily_streak_cycles_completion_date ON daily_streak_cycles(completion_date);
CREATE INDEX IF NOT EXISTS idx_daily_streak_cycles_reward_set ON daily_streak_cycles(reward_set);

-- 5. Create daily streak analytics view
CREATE OR REPLACE VIEW daily_streak_analytics AS
SELECT 
    ds.player_id,
    p.player_name,
    ds.current_streak,
    ds.current_cycle,
    ds.cycle_reward_set,
    ds.total_cycles_completed,
    ds.last_claim_date,
    ds.cycle_start_date,
    ds.last_cycle_completion_date,
    ds.max_streak,
    ds.total_claims,
    COUNT(dsc.id) as cycles_completed_count,
    AVG(EXTRACT(DAYS FROM (dsc.completion_date::timestamp - dsc.start_date::timestamp))) as avg_cycle_duration,
    MAX(dsc.completion_date) as last_completed_cycle_date
FROM daily_streaks ds
JOIN players p ON ds.player_id = p.id
LEFT JOIN daily_streak_cycles dsc ON ds.player_id = dsc.player_id
GROUP BY ds.player_id, p.player_name, ds.current_streak, ds.current_cycle, 
         ds.cycle_reward_set, ds.total_cycles_completed, ds.last_claim_date, 
         ds.cycle_start_date, ds.last_cycle_completion_date, ds.max_streak, ds.total_claims;

-- 6. Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 7. Create triggers for automatic timestamp updates
DROP TRIGGER IF EXISTS update_daily_streaks_updated_at ON daily_streaks;
CREATE TRIGGER update_daily_streaks_updated_at
    BEFORE UPDATE ON daily_streaks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_streak_cycles_updated_at ON daily_streak_cycles;
CREATE TRIGGER update_daily_streak_cycles_updated_at
    BEFORE UPDATE ON daily_streak_cycles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 8. Create function to determine reward set based on player's skin count
CREATE OR REPLACE FUNCTION determine_reward_set(player_uuid UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    skin_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO skin_count
    FROM player_skins ps
    WHERE ps.player_id = player_uuid;
    
    IF skin_count <= 1 THEN
        RETURN 'new_player';
    ELSE
        RETURN 'experienced';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. Create function to validate streak progression
CREATE OR REPLACE FUNCTION validate_streak_progression(
    player_uuid UUID,
    new_streak INTEGER,
    new_cycle INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
    current_streak INTEGER;
    current_cycle INTEGER;
BEGIN
    SELECT ds.current_streak, ds.current_cycle
    INTO current_streak, current_cycle
    FROM daily_streaks ds
    WHERE ds.player_id = player_uuid;
    
    -- Validate streak progression
    IF new_streak < 0 OR new_streak > 7 THEN
        RETURN FALSE;
    END IF;
    
    -- Validate cycle progression
    IF new_cycle < 0 THEN
        RETURN FALSE;
    END IF;
    
    -- Validate cycle completion logic
    IF new_streak = 0 AND new_cycle > current_cycle THEN
        -- This is a cycle completion, which is valid
        RETURN TRUE;
    END IF;
    
    -- Normal progression validation
    IF new_streak = current_streak + 1 OR 
       (new_streak = 1 AND current_streak = 0) THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 10. Verify the schema changes
SELECT 
    column_name, 
    data_type, 
    is_nullable 
FROM information_schema.columns 
WHERE table_name = 'daily_streaks' 
ORDER BY ordinal_position;

SELECT 
    column_name, 
    data_type, 
    is_nullable 
FROM information_schema.columns 
WHERE table_name = 'daily_streak_cycles' 
ORDER BY ordinal_position;

-- 11. Show current daily streaks count
SELECT COUNT(*) as total_daily_streaks FROM daily_streaks;

COMMIT;
