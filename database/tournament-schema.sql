-- Tournament System Database Schema
-- FlappyJet Pro Weekly Competitions with Prizes

-- Main tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    tournament_type VARCHAR(50) NOT NULL DEFAULT 'weekly', -- 'weekly', 'monthly', 'special'
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    registration_start TIMESTAMP WITH TIME ZONE,
    registration_end TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) NOT NULL DEFAULT 'upcoming', -- 'upcoming', 'registration', 'active', 'ended', 'cancelled'
    prize_pool INTEGER NOT NULL DEFAULT 1750, -- Total prize pool in coins (1000+500+250)
    prize_distribution JSONB NOT NULL DEFAULT '{"1": 1000, "2": 500, "3": 250}', -- Fixed coin amounts
    max_participants INTEGER DEFAULT NULL, -- NULL = unlimited
    entry_fee INTEGER DEFAULT 0, -- Entry fee in coins
    minimum_score INTEGER DEFAULT 0, -- Minimum score to qualify for prizes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID, -- Admin who created tournament
    
    -- Constraints
    CONSTRAINT valid_dates CHECK (end_date > start_date),
    CONSTRAINT valid_registration CHECK (
        (registration_start IS NULL AND registration_end IS NULL) OR
        (registration_start IS NOT NULL AND registration_end IS NOT NULL AND registration_end >= registration_start)
    ),
    CONSTRAINT valid_prize_pool CHECK (prize_pool >= 0),
    CONSTRAINT valid_entry_fee CHECK (entry_fee >= 0)
);

-- Tournament participants
CREATE TABLE IF NOT EXISTS tournament_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    player_name VARCHAR(255) NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    entry_fee_paid INTEGER DEFAULT 0,
    best_score INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    final_rank INTEGER DEFAULT NULL,
    prize_won INTEGER DEFAULT 0,
    prize_claimed BOOLEAN DEFAULT FALSE,
    prize_claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    
    -- Constraints
    UNIQUE(tournament_id, player_id), -- One registration per player per tournament
    CONSTRAINT valid_best_score CHECK (best_score >= 0),
    CONSTRAINT valid_total_games CHECK (total_games >= 0),
    CONSTRAINT valid_prize_won CHECK (prize_won >= 0)
);

-- Tournament leaderboard snapshots (for historical data)
CREATE TABLE IF NOT EXISTS tournament_leaderboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    player_name VARCHAR(255) NOT NULL,
    score INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    games_played INTEGER DEFAULT 1,
    snapshot_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_final BOOLEAN DEFAULT FALSE, -- TRUE for final tournament results
    
    -- Constraints
    CONSTRAINT valid_score CHECK (score >= 0),
    CONSTRAINT valid_rank CHECK (rank > 0),
    CONSTRAINT valid_games_played CHECK (games_played >= 0)
);

-- Tournament events log (for audit trail)
CREATE TABLE IF NOT EXISTS tournament_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL, -- 'created', 'started', 'ended', 'participant_joined', 'score_submitted', 'prize_distributed'
    event_data JSONB DEFAULT '{}',
    player_id UUID DEFAULT NULL, -- NULL for tournament-level events
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(100) DEFAULT 'system' -- 'system', 'admin', 'player'
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_type_status ON tournaments(tournament_type, status);
CREATE INDEX IF NOT EXISTS idx_tournaments_dates ON tournaments(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament ON tournament_participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_player ON tournament_participants(player_id);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_score ON tournament_participants(tournament_id, best_score DESC);
CREATE INDEX IF NOT EXISTS idx_tournament_leaderboards_tournament ON tournament_leaderboards(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_leaderboards_final ON tournament_leaderboards(tournament_id, is_final, rank);
CREATE INDEX IF NOT EXISTS idx_tournament_events_tournament ON tournament_events(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_events_type ON tournament_events(event_type, created_at);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tournaments_updated_at BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample weekly tournament creation function
CREATE OR REPLACE FUNCTION create_weekly_tournament(
    p_name VARCHAR(255) DEFAULT NULL,
    p_prize_pool INTEGER DEFAULT 1750,
    p_start_offset_hours INTEGER DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
    tournament_id UUID;
    tournament_name VARCHAR(255);
    start_time TIMESTAMP WITH TIME ZONE;
    end_time TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Calculate tournament dates (Monday 00:00 UTC to Sunday 23:59 UTC)
    start_time := date_trunc('week', NOW() + INTERVAL '1 week') + (p_start_offset_hours || ' hours')::INTERVAL;
    end_time := start_time + INTERVAL '6 days 23 hours 59 minutes 59 seconds';
    
    -- Generate tournament name if not provided
    IF p_name IS NULL THEN
        tournament_name := 'Weekly Championship ' || to_char(start_time, 'YYYY-MM-DD');
    ELSE
        tournament_name := p_name;
    END IF;
    
    -- Create tournament
    INSERT INTO tournaments (
        name,
        description,
        tournament_type,
        start_date,
        end_date,
        status,
        prize_pool,
        prize_distribution
    ) VALUES (
        tournament_name,
        'Weekly competition for FlappyJet Pro players. Compete for coins and exclusive rewards!',
        'weekly',
        start_time,
        end_time,
        'upcoming',
        p_prize_pool,
        '{"1": 1000, "2": 500, "3": 250}'::JSONB
    ) RETURNING id INTO tournament_id;
    
    -- Log tournament creation
    INSERT INTO tournament_events (tournament_id, event_type, event_data)
    VALUES (tournament_id, 'created', jsonb_build_object('prize_pool', p_prize_pool));
    
    RETURN tournament_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get current active tournament
CREATE OR REPLACE FUNCTION get_current_tournament()
RETURNS TABLE (
    id UUID,
    name VARCHAR(255),
    tournament_type VARCHAR(50),
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50),
    prize_pool INTEGER,
    participant_count BIGINT,
    time_remaining INTERVAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.name,
        t.tournament_type,
        t.start_date,
        t.end_date,
        t.status,
        t.prize_pool,
        COALESCE(p.participant_count, 0) as participant_count,
        CASE 
            WHEN t.status = 'active' THEN t.end_date - NOW()
            WHEN t.status = 'upcoming' THEN t.start_date - NOW()
            ELSE INTERVAL '0'
        END as time_remaining
    FROM tournaments t
    LEFT JOIN (
        SELECT tournament_id, COUNT(*) as participant_count
        FROM tournament_participants
        GROUP BY tournament_id
    ) p ON t.id = p.tournament_id
    WHERE t.status IN ('active', 'upcoming')
    ORDER BY t.start_date ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;
