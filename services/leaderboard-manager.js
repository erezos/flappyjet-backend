/**
 * Leaderboard Manager Service
 * Handles global leaderboards and player scores for FlappyJet Pro
 */

const { v4: uuidv4, validate: isValidUUID } = require('uuid');

class LeaderboardManager {
  constructor({ db, cacheManager }) {
    this.db = db;
    this.cache = cacheManager;
    
    // Cache keys
    this.CACHE_KEYS = {
      GLOBAL_LEADERBOARD: 'leaderboard:global',
      PLAYER_SCORES: (playerId) => `leaderboard:player:${playerId}`,
      PLAYER_RANK: (playerId) => `leaderboard:rank:${playerId}`
    };
    
    // Cache TTL (Time To Live)
    this.CACHE_TTL = {
      GLOBAL_LEADERBOARD: 300, // 5 minutes
      PLAYER_SCORES: 600, // 10 minutes
      PLAYER_RANK: 300 // 5 minutes
    };
    
    this._ensureTables();
  }

  /**
   * Ensure required database tables exist
   */
  async _ensureTables() {
    try {
      const createTablesQuery = `
        -- Players table for storing player information
        CREATE TABLE IF NOT EXISTS players (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          player_id UUID UNIQUE NOT NULL,
          player_name VARCHAR(255) NOT NULL,
          best_score INTEGER DEFAULT 0,
          total_games INTEGER DEFAULT 0,
          total_play_time INTEGER DEFAULT 0,
          jet_skin VARCHAR(255) DEFAULT 'jets/green_lightning.png',
          theme VARCHAR(255) DEFAULT 'sky',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          
          CONSTRAINT valid_best_score CHECK (best_score >= 0),
          CONSTRAINT valid_total_games CHECK (total_games >= 0),
          CONSTRAINT valid_total_play_time CHECK (total_play_time >= 0)
        );

        -- Game sessions table for storing individual game scores
        CREATE TABLE IF NOT EXISTS game_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          player_id UUID NOT NULL,
          player_name VARCHAR(255) NOT NULL,
          score INTEGER NOT NULL,
          survival_time INTEGER DEFAULT 0,
          jet_skin VARCHAR(255) DEFAULT 'jets/green_lightning.png',
          theme VARCHAR(255) DEFAULT 'sky',
          game_data JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          
          CONSTRAINT valid_score CHECK (score >= 0),
          CONSTRAINT valid_survival_time CHECK (survival_time >= 0)
        );

        -- Performance indexes
        CREATE INDEX IF NOT EXISTS idx_players_player_id ON players(player_id);
        CREATE INDEX IF NOT EXISTS idx_players_best_score ON players(best_score DESC);
        CREATE INDEX IF NOT EXISTS idx_players_name ON players(player_name);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_player_id ON game_sessions(player_id);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_score ON game_sessions(score DESC);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_created_at ON game_sessions(created_at DESC);

        -- Triggers for updated_at
        CREATE OR REPLACE FUNCTION update_players_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';

        CREATE TRIGGER update_players_updated_at_trigger 
        BEFORE UPDATE ON players
        FOR EACH ROW EXECUTE FUNCTION update_players_updated_at();
      `;

      await this.db.query(createTablesQuery);
      console.log('✅ Leaderboard tables ensured');

    } catch (error) {
      console.error('❌ Error ensuring leaderboard tables:', error);
    }
  }

  /**
   * Get global leaderboard with top players
   */
  async getGlobalLeaderboard({ limit = 15, offset = 0, requestingPlayerId = null }) {
    try {
      // Try cache first
      const cacheKey = `${this.CACHE_KEYS.GLOBAL_LEADERBOARD}:${limit}:${offset}`;
      const cached = await this.cache.get(cacheKey);
      
      if (cached && !requestingPlayerId) {
        return {
          success: true,
          leaderboard: cached,
          userPosition: null
        };
      }

      // Get top players
      const leaderboardQuery = `
        SELECT 
          player_id,
          player_name,
          best_score,
          total_games,
          jet_skin,
          theme,
          updated_at,
          ROW_NUMBER() OVER (ORDER BY best_score DESC, updated_at ASC) as rank
        FROM players 
        WHERE best_score > 0
        ORDER BY best_score DESC, updated_at ASC
        LIMIT $1 OFFSET $2
      `;

      const result = await this.db.query(leaderboardQuery, [limit, offset]);
      const leaderboard = result.rows.map(row => ({
        playerId: row.player_id,
        playerName: row.player_name,
        score: row.best_score,
        totalGames: row.total_games,
        jetSkin: row.jet_skin,
        theme: row.theme,
        rank: parseInt(row.rank) + offset,
        achievedAt: row.updated_at
      }));

      // Cache the result
      await this.cache.set(cacheKey, leaderboard, this.CACHE_TTL.GLOBAL_LEADERBOARD);

      let userPosition = null;
      
      // Get user's position if requested
      if (requestingPlayerId && isValidUUID(requestingPlayerId)) {
        userPosition = await this._getUserPosition(requestingPlayerId);
      }

      return {
        success: true,
        leaderboard,
        userPosition
      };

    } catch (error) {
      console.error('Error getting global leaderboard:', error);
      return {
        success: false,
        error: 'Failed to get global leaderboard: ' + error.message
      };
    }
  }

  /**
   * Get user's position in global leaderboard
   */
  async _getUserPosition(playerId) {
    try {
      const cacheKey = this.CACHE_KEYS.PLAYER_RANK(playerId);
      const cached = await this.cache.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      const rankQuery = `
        WITH ranked_players AS (
          SELECT 
            player_id,
            player_name,
            best_score,
            jet_skin,
            theme,
            updated_at,
            ROW_NUMBER() OVER (ORDER BY best_score DESC, updated_at ASC) as rank
          FROM players 
          WHERE best_score > 0
        )
        SELECT * FROM ranked_players WHERE player_id = $1
      `;

      const result = await this.db.query(rankQuery, [playerId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const userPosition = {
        playerId: result.rows[0].player_id,
        playerName: result.rows[0].player_name,
        score: result.rows[0].best_score,
        jetSkin: result.rows[0].jet_skin,
        theme: result.rows[0].theme,
        rank: parseInt(result.rows[0].rank),
        achievedAt: result.rows[0].updated_at
      };

      // Cache the result
      await this.cache.set(cacheKey, userPosition, this.CACHE_TTL.PLAYER_RANK);

      return userPosition;

    } catch (error) {
      console.error('Error getting user position:', error);
      return null;
    }
  }

  /**
   * Get player's personal top scores
   */
  async getPlayerPersonalScores(playerId, limit = 10) {
    try {
      const cacheKey = `${this.CACHE_KEYS.PLAYER_SCORES(playerId)}:${limit}`;
      const cached = await this.cache.get(cacheKey);
      
      if (cached) {
        return {
          success: true,
          scores: cached
        };
      }

      const scoresQuery = `
        SELECT 
          score,
          survival_time,
          jet_skin,
          theme,
          game_data,
          created_at
        FROM game_sessions 
        WHERE player_id = $1
        ORDER BY score DESC, created_at DESC
        LIMIT $2
      `;

      const result = await this.db.query(scoresQuery, [playerId, limit]);
      const scores = result.rows.map((row, index) => ({
        rank: index + 1,
        score: row.score,
        survivalTime: row.survival_time,
        jetSkin: row.jet_skin,
        theme: row.theme,
        gameData: row.game_data,
        achievedAt: row.created_at
      }));

      // Cache the result
      await this.cache.set(cacheKey, scores, this.CACHE_TTL.PLAYER_SCORES);

      return {
        success: true,
        scores
      };

    } catch (error) {
      console.error('Error getting player personal scores:', error);
      return {
        success: false,
        error: 'Failed to get personal scores: ' + error.message
      };
    }
  }

  /**
   * Submit a new score
   */
  async submitScore({ playerId, playerName, score, gameData = {}, jetSkin = 'jets/green_lightning.png', theme = 'sky' }) {
    try {
      // Validate inputs
      if (!playerId || !playerName || score < 0) {
        return {
          success: false,
          error: 'Invalid input parameters'
        };
      }

      // Insert game session
      const sessionQuery = `
        INSERT INTO game_sessions (
          player_id, player_name, score, jet_skin, theme, game_data
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;

      await this.db.query(sessionQuery, [
        playerId, playerName, score, jetSkin, theme, JSON.stringify(gameData)
      ]);

      // Update or create player record
      const upsertPlayerQuery = `
        INSERT INTO players (player_id, player_name, best_score, total_games, jet_skin, theme)
        VALUES ($1, $2, $3, 1, $4, $5)
        ON CONFLICT (player_id) 
        DO UPDATE SET 
          player_name = EXCLUDED.player_name,
          best_score = GREATEST(players.best_score, EXCLUDED.best_score),
          total_games = players.total_games + 1,
          jet_skin = EXCLUDED.jet_skin,
          theme = EXCLUDED.theme,
          updated_at = NOW()
        RETURNING best_score, (best_score = $3) as is_new_best
      `;

      const playerResult = await this.db.query(upsertPlayerQuery, [
        playerId, playerName, score, jetSkin, theme
      ]);

      const isNewBest = playerResult.rows[0].is_new_best;

      // Clear relevant caches
      await this.cache.delete(this.CACHE_KEYS.GLOBAL_LEADERBOARD + ':*');
      await this.cache.delete(this.CACHE_KEYS.PLAYER_SCORES(playerId));
      await this.cache.delete(this.CACHE_KEYS.PLAYER_RANK(playerId));

      // Get global rank if new best
      let globalRank = null;
      if (isNewBest) {
        const userPosition = await this._getUserPosition(playerId);
        globalRank = userPosition ? userPosition.rank : null;
      }

      return {
        success: true,
        newBest: isNewBest,
        globalRank,
        score
      };

    } catch (error) {
      console.error('Error submitting score:', error);
      return {
        success: false,
        error: 'Failed to submit score: ' + error.message
      };
    }
  }

  /**
   * Update player nickname across all records
   */
  async updatePlayerNickname(playerId, newNickname) {
    try {
      if (!playerId || !newNickname) {
        return {
          success: false,
          error: 'Player ID and nickname required'
        };
      }

      // Update player record
      const updatePlayerQuery = `
        UPDATE players 
        SET player_name = $1, updated_at = NOW()
        WHERE player_id = $2
        RETURNING id
      `;

      await this.db.query(updatePlayerQuery, [newNickname, playerId]);

      // Update recent game sessions (last 100)
      const updateSessionsQuery = `
        UPDATE game_sessions 
        SET player_name = $1
        WHERE player_id = $2 
          AND id IN (
            SELECT id FROM game_sessions 
            WHERE player_id = $2 
            ORDER BY created_at DESC 
            LIMIT 100
          )
      `;

      await this.db.query(updateSessionsQuery, [newNickname, playerId]);

      // Clear caches
      await this.cache.delete(this.CACHE_KEYS.GLOBAL_LEADERBOARD + ':*');
      await this.cache.delete(this.CACHE_KEYS.PLAYER_SCORES(playerId));
      await this.cache.delete(this.CACHE_KEYS.PLAYER_RANK(playerId));

      return {
        success: true,
        message: 'Nickname updated successfully'
      };

    } catch (error) {
      console.error('Error updating player nickname:', error);
      return {
        success: false,
        error: 'Failed to update nickname: ' + error.message
      };
    }
  }
}

module.exports = LeaderboardManager;
