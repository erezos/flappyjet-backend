/**
 * Tournament Manager Service
 * Handles weekly competitions with prizes for FlappyJet Pro
 */

const { v4: uuidv4, validate: isValidUUID } = require('uuid');
const { ValidationException, NetworkException } = require('../utils/exceptions');
const logger = require('../utils/logger');

class TournamentManager {
  constructor({ db, cacheManager, prizeManager, wsManager }) {
    this.db = db;
    this.cache = cacheManager;
    this.prizeManager = prizeManager;
    this.wsManager = wsManager;
    
    // Cache keys
    this.CACHE_KEYS = {
      CURRENT_TOURNAMENT: 'tournament:current',
      TOURNAMENT_LEADERBOARD: (id) => `tournament:leaderboard:${id}`,
      TOURNAMENT_PARTICIPANTS: (id) => `tournament:participants:${id}`,
      PLAYER_STATS: (playerId) => `tournament:player_stats:${playerId}`
    };
    
    // Cache TTL (Time To Live)
    this.CACHE_TTL = {
      CURRENT_TOURNAMENT: 300, // 5 minutes
      LEADERBOARD: 60, // 1 minute
      PARTICIPANTS: 300, // 5 minutes
      PLAYER_STATS: 600 // 10 minutes
    };
  }

  /**
   * Create a new weekly tournament
   */
  async createWeeklyTournament(options = {}) {
    try {
      const {
        name = null,
        prizePool = 1750, // Total: 1000 + 500 + 250 coins
        startOffsetHours = 0,
        description = null
      } = options;

      // Validate inputs
      if (prizePool < 0) {
        return {
          success: false,
          error: 'Prize pool must be non-negative'
        };
      }

      // Create tournament using database function
      const query = `
        SELECT create_weekly_tournament($1, $2, $3) as tournament_id
      `;
      
      const result = await this.db.query(query, [name, prizePool, startOffsetHours]);
      
      if (!result.rows.length) {
        throw new Error('Failed to create tournament');
      }

      const tournamentId = result.rows[0].tournament_id;

      // Get the created tournament details
      const tournamentQuery = `
        SELECT id, name, tournament_type, start_date, end_date, status, prize_pool
        FROM tournaments 
        WHERE id = $1
      `;
      
      const tournamentResult = await this.db.query(tournamentQuery, [tournamentId]);
      const tournament = tournamentResult.rows[0];

      // Clear current tournament cache
      await this.cache.delete(this.CACHE_KEYS.CURRENT_TOURNAMENT);

      // Log creation event
      await this._logTournamentEvent(tournamentId, 'created', {
        prize_pool: prizePool,
        created_by: 'system'
      });

      return {
        success: true,
        tournament: {
          id: tournament.id,
          name: tournament.name,
          type: tournament.tournament_type,
          startDate: tournament.start_date,
          endDate: tournament.end_date,
          status: tournament.status,
          prizePool: tournament.prize_pool
        }
      };

    } catch (error) {
      logger.error('Error creating weekly tournament:', error);
      return {
        success: false,
        error: 'Failed to create tournament: ' + error.message
      };
    }
  }

  /**
   * Register a player for a tournament
   */
  async registerPlayer(tournamentId, playerData) {
    try {
      const { playerId, playerName } = playerData;

      // Debug logging
      logger.info('🏆 Tournament registration debug:', {
        tournamentId,
        playerId,
        playerName,
        playerIdType: typeof playerId,
        isValidUUID: isValidUUID(playerId)
      });

      // Validate inputs
      if (!isValidUUID(tournamentId)) {
        return {
          success: false,
          error: 'Invalid tournament ID format'
        };
      }

      if (!playerId || !playerName) {
        return {
          success: false,
          error: 'Player ID and name are required'
        };
      }

      if (!isValidUUID(playerId)) {
        return {
          success: false,
          error: `Invalid player ID format: ${playerId}`
        };
      }

      // Check tournament status and availability
      const tournamentQuery = `
        SELECT id, status, entry_fee, max_participants, start_date, end_date
        FROM tournaments 
        WHERE id = $1
      `;
      
      const tournamentResult = await this.db.query(tournamentQuery, [tournamentId]);
      
      if (!tournamentResult.rows.length) {
        return {
          success: false,
          error: 'Tournament not found'
        };
      }

      const tournament = tournamentResult.rows[0];

      // Check if registration is allowed
      if (tournament.status !== 'upcoming' && tournament.status !== 'registration' && tournament.status !== 'active') {
        return {
          success: false,
          error: 'Tournament registration is closed'
        };
      }

      // Check participant limit
      if (tournament.max_participants) {
        const countQuery = `
          SELECT COUNT(*) as count
          FROM tournament_participants 
          WHERE tournament_id = $1
        `;
        
        const countResult = await this.db.query(countQuery, [tournamentId]);
        const currentCount = parseInt(countResult.rows[0].count);

        if (currentCount >= tournament.max_participants) {
          return {
            success: false,
            error: 'Tournament is full'
          };
        }
      }

      // Register player
      const registerQuery = `
        INSERT INTO tournament_participants (
          tournament_id, player_id, player_name, entry_fee_paid
        ) VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      
      const registerResult = await this.db.query(registerQuery, [
        tournamentId, playerId, playerName, tournament.entry_fee
      ]);

      // Clear relevant caches
      await this.cache.delete(this.CACHE_KEYS.TOURNAMENT_PARTICIPANTS(tournamentId));
      await this.cache.delete(this.CACHE_KEYS.PLAYER_STATS(playerId));

      // Log registration event
      await this._logTournamentEvent(tournamentId, 'participant_joined', {
        player_id: playerId,
        player_name: playerName
      });

      // Notify player via WebSocket
      if (this.wsManager) {
        await this.wsManager.notifyPlayer(playerId, {
          type: 'tournament_registered',
          tournamentId: tournamentId,
          tournamentName: tournament.name || 'Weekly Championship'
        });
      }

      return {
        success: true,
        participantId: registerResult.rows[0].id,
        message: 'Successfully registered for tournament'
      };

    } catch (error) {
      if (error.message.includes('duplicate key value')) {
        return {
          success: false,
          error: 'Player is already registered for this tournament'
        };
      }

      logger.error('Error registering player for tournament:', error);
      return {
        success: false,
        error: 'Registration failed: ' + error.message
      };
    }
  }

  /**
   * Submit a score for a tournament
   */
  async submitScore(tournamentId, scoreData) {
    try {
      const { playerId, score, gameData = {} } = scoreData;

      // Validate inputs
      if (!isValidUUID(tournamentId) || !playerId || score < 0) {
        return {
          success: false,
          error: 'Invalid input parameters'
        };
      }

      // Check if player is registered for this tournament
      const participantQuery = `
        SELECT tournament_id, player_id, player_name, best_score, total_games
        FROM tournament_participants 
        WHERE tournament_id = $1 AND player_id = $2
      `;
      
      const participantResult = await this.db.query(participantQuery, [tournamentId, playerId]);
      
      if (!participantResult.rows.length) {
        return {
          success: false,
          error: 'Player is not registered for this tournament'
        };
      }

      const participant = participantResult.rows[0];
      const isNewBest = score > participant.best_score;

      // Update participant's best score if this is better
      if (isNewBest) {
        const updateQuery = `
          UPDATE tournament_participants 
          SET best_score = $1, total_games = total_games + 1
          WHERE tournament_id = $2 AND player_id = $3
          RETURNING id
        `;
        
        await this.db.query(updateQuery, [score, tournamentId, playerId]);

        // Create leaderboard snapshot
        await this._createLeaderboardSnapshot(tournamentId, playerId, participant.player_name, score);

        // Clear leaderboard cache
        await this.cache.delete(this.CACHE_KEYS.TOURNAMENT_LEADERBOARD(tournamentId));
      } else {
        // Just increment games played
        const updateQuery = `
          UPDATE tournament_participants 
          SET total_games = total_games + 1
          WHERE tournament_id = $2 AND player_id = $3
        `;
        
        await this.db.query(updateQuery, [tournamentId, playerId]);
      }

      // Get updated leaderboard position
      const rank = await this._getPlayerRank(tournamentId, playerId);

      // Log score submission
      await this._logTournamentEvent(tournamentId, 'score_submitted', {
        player_id: playerId,
        score: score,
        new_best: isNewBest,
        rank: rank,
        game_data: gameData
      });

      // Broadcast leaderboard update via WebSocket
      if (this.wsManager && isNewBest) {
        const leaderboard = await this._getTournamentLeaderboard(tournamentId, { limit: 10 });
        
        await this.wsManager.broadcastToRoom(`tournament_${tournamentId}`, {
          type: 'leaderboard_update',
          tournamentId: tournamentId,
          leaderboard: leaderboard,
          updatedPlayer: {
            playerId: playerId,
            playerName: participant.player_name,
            score: score,
            rank: rank
          }
        });
      }

      return {
        success: true,
        newBest: isNewBest,
        score: score,
        previousBest: participant.best_score,
        rank: rank,
        totalGames: participant.total_games + 1
      };

    } catch (error) {
      logger.error('Error submitting tournament score:', error);
      return {
        success: false,
        error: 'Score submission failed: ' + error.message
      };
    }
  }

  /**
   * Start a tournament
   */
  async startTournament(tournamentId) {
    try {
      if (!isValidUUID(tournamentId)) {
        return {
          success: false,
          error: 'Invalid tournament ID format'
        };
      }

      // Update tournament status to active
      const updateQuery = `
        UPDATE tournaments 
        SET status = $1, updated_at = NOW()
        WHERE id = $2 AND status = 'upcoming'
        RETURNING id, name
      `;
      
      const result = await this.db.query(updateQuery, ['active', tournamentId]);
      
      if (!result.rows.length) {
        return {
          success: false,
          error: 'Tournament not found or already started'
        };
      }

      // Clear caches
      await this.cache.delete(this.CACHE_KEYS.CURRENT_TOURNAMENT);

      // Get participants for notifications
      const participantsQuery = `
        SELECT player_id, player_name
        FROM tournament_participants 
        WHERE tournament_id = $1
      `;
      
      const participantsResult = await this.db.query(participantsQuery, [tournamentId]);

      // Log tournament start
      await this._logTournamentEvent(tournamentId, 'started', {
        participant_count: participantsResult.rows.length
      });

      // Notify all participants via WebSocket
      if (this.wsManager) {
        await this.wsManager.broadcastToRoom(`tournament_${tournamentId}`, {
          type: 'tournament_started',
          tournamentId: tournamentId,
          message: 'Tournament has started! Good luck!'
        });
      }

      return {
        success: true,
        message: 'Tournament started successfully',
        participantCount: participantsResult.rows.length
      };

    } catch (error) {
      logger.error('Error starting tournament:', error);
      return {
        success: false,
        error: 'Failed to start tournament: ' + error.message
      };
    }
  }

  /**
   * End a tournament and distribute prizes
   */
  async endTournament(tournamentId) {
    try {
      if (!isValidUUID(tournamentId)) {
        return {
          success: false,
          error: 'Invalid tournament ID format'
        };
      }

      // Get tournament details
      const tournamentQuery = `
        SELECT id, name, prize_pool, prize_distribution, status
        FROM tournaments 
        WHERE id = $1
      `;
      
      const tournamentResult = await this.db.query(tournamentQuery, [tournamentId]);
      
      if (!tournamentResult.rows.length) {
        return {
          success: false,
          error: 'Tournament not found'
        };
      }

      const tournament = tournamentResult.rows[0];

      if (tournament.status === 'ended') {
        return {
          success: false,
          error: 'Tournament already ended'
        };
      }

      // Get final leaderboard
      const finalLeaderboard = await this._getTournamentLeaderboard(tournamentId, { 
        limit: 100,
        final: true 
      });

      // Distribute prizes
      const prizeResult = await this.prizeManager.distributePrizes(
        tournamentId,
        finalLeaderboard,
        tournament.prize_distribution,
        tournament.prize_pool
      );

      if (!prizeResult.success) {
        throw new Error('Prize distribution failed: ' + prizeResult.error);
      }

      // Update tournament status to ended
      const updateQuery = `
        UPDATE tournaments 
        SET status = 'ended', updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `;
      
      await this.db.query(updateQuery, [tournamentId]);

      // Create final leaderboard snapshots
      for (const entry of finalLeaderboard) {
        await this._createLeaderboardSnapshot(
          tournamentId, 
          entry.player_id, 
          entry.player_name, 
          entry.score,
          true // is_final
        );
      }

      // Clear all related caches
      await this.cache.delete(this.CACHE_KEYS.CURRENT_TOURNAMENT);
      await this.cache.delete(this.CACHE_KEYS.TOURNAMENT_LEADERBOARD(tournamentId));

      // Log tournament end
      await this._logTournamentEvent(tournamentId, 'ended', {
        final_leaderboard: finalLeaderboard.slice(0, 10), // Top 10
        prizes_distributed: prizeResult.distributions.length,
        total_prize_amount: prizeResult.totalDistributed
      });

      // Notify all participants of tournament end
      if (this.wsManager) {
        await this.wsManager.broadcastToRoom(`tournament_${tournamentId}`, {
          type: 'tournament_ended',
          tournamentId: tournamentId,
          finalLeaderboard: finalLeaderboard.slice(0, 10),
          prizeDistributions: prizeResult.distributions
        });
      }

      return {
        success: true,
        finalLeaderboard: finalLeaderboard,
        prizeDistributions: prizeResult.distributions,
        totalPrizesDistributed: prizeResult.totalDistributed,
        message: 'Tournament ended successfully'
      };

    } catch (error) {
      logger.error('Error ending tournament:', error);
      return {
        success: false,
        error: 'Failed to end tournament: ' + error.message
      };
    }
  }

  /**
   * Get current active tournament
   */
  async getCurrentTournament() {
    try {
      // Check cache first
      const cached = await this.cache.get(this.CACHE_KEYS.CURRENT_TOURNAMENT);
      if (cached) {
        return {
          success: true,
          tournament: cached
        };
      }

      // Query database
      const query = `SELECT * FROM get_current_tournament()`;
      const result = await this.db.query(query);

      if (!result.rows.length) {
        return {
          success: true,
          tournament: null,
          message: 'No active tournament'
        };
      }

      const tournament = result.rows[0];

      // Cache result
      await this.cache.set(
        this.CACHE_KEYS.CURRENT_TOURNAMENT,
        tournament,
        this.CACHE_TTL.CURRENT_TOURNAMENT
      );

      return {
        success: true,
        tournament: tournament
      };

    } catch (error) {
      logger.error('Error getting current tournament:', error);
      return {
        success: false,
        error: 'Database error: ' + error.message
      };
    }
  }

  /**
   * Get tournament leaderboard
   */
  async getTournamentLeaderboard(tournamentId, options = {}) {
    try {
      if (!isValidUUID(tournamentId)) {
        return {
          success: false,
          error: 'Invalid tournament ID format'
        };
      }

      const { limit = 100, offset = 0 } = options;
      const cacheKey = `${this.CACHE_KEYS.TOURNAMENT_LEADERBOARD(tournamentId)}:${limit}:${offset}`;

      // Check cache first
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return {
          success: true,
          leaderboard: cached
        };
      }

      // Get leaderboard from database
      const leaderboard = await this._getTournamentLeaderboard(tournamentId, options);

      // Cache result
      await this.cache.set(cacheKey, leaderboard, this.CACHE_TTL.LEADERBOARD);

      return {
        success: true,
        leaderboard: leaderboard
      };

    } catch (error) {
      logger.error('Error getting tournament leaderboard:', error);
      return {
        success: false,
        error: 'Failed to get leaderboard: ' + error.message
      };
    }
  }

  /**
   * Get player tournament statistics
   */
  async getPlayerStats(playerId) {
    try {
      const cacheKey = this.CACHE_KEYS.PLAYER_STATS(playerId);

      // Check cache first
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return {
          success: true,
          stats: cached
        };
      }

      // Query player statistics
      const query = `
        SELECT 
          COUNT(DISTINCT tp.tournament_id) as tournaments_joined,
          MIN(tp.final_rank) as best_rank,
          COALESCE(SUM(tp.prize_won), 0) as total_prizes,
          (
            SELECT tp2.final_rank 
            FROM tournament_participants tp2
            JOIN tournaments t2 ON tp2.tournament_id = t2.id
            WHERE tp2.player_id = $1 AND t2.status = 'active'
            LIMIT 1
          ) as current_tournament_rank
        FROM tournament_participants tp
        WHERE tp.player_id = $1
      `;

      const result = await this.db.query(query, [playerId]);
      const stats = result.rows[0] || {
        tournaments_joined: 0,
        best_rank: null,
        total_prizes: 0,
        current_tournament_rank: null
      };

      // Cache result
      await this.cache.set(cacheKey, stats, this.CACHE_TTL.PLAYER_STATS);

      return {
        success: true,
        stats: stats
      };

    } catch (error) {
      logger.error('Error getting player tournament stats:', error);
      return {
        success: false,
        error: 'Failed to get player stats: ' + error.message
      };
    }
  }

  // Private helper methods

  async _getTournamentLeaderboard(tournamentId, options = {}) {
    const { limit = 100, offset = 0, final = false } = options;

    const query = `
      SELECT 
        tp.player_id,
        tp.player_name,
        tp.best_score as score,
        ROW_NUMBER() OVER (ORDER BY tp.best_score DESC, tp.registered_at ASC) as rank,
        tp.total_games,
        tp.final_rank,
        tp.prize_won
      FROM tournament_participants tp
      WHERE tp.tournament_id = $1 AND tp.best_score > 0
      ORDER BY tp.best_score DESC, tp.registered_at ASC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.db.query(query, [tournamentId, limit, offset]);
    
    // Ensure rank is returned as integer
    return result.rows.map(row => ({
      ...row,
      rank: parseInt(row.rank, 10),
      score: parseInt(row.score, 10),
      total_games: parseInt(row.total_games, 10),
      final_rank: row.final_rank ? parseInt(row.final_rank, 10) : null,
      prize_won: parseInt(row.prize_won || 0, 10)
    }));
  }

  async _getPlayerRank(tournamentId, playerId) {
    const query = `
      SELECT COUNT(*) + 1 as rank
      FROM tournament_participants tp1
      JOIN tournament_participants tp2 ON tp1.tournament_id = tp2.tournament_id
      WHERE tp1.tournament_id = $1 
        AND tp1.player_id = $2
        AND tp2.best_score > tp1.best_score
    `;

    const result = await this.db.query(query, [tournamentId, playerId]);
    const rank = result.rows[0]?.rank;
    return rank ? parseInt(rank, 10) : null;
  }

  async _createLeaderboardSnapshot(tournamentId, playerId, playerName, score, isFinal = false) {
    const rank = await this._getPlayerRank(tournamentId, playerId);

    const query = `
      INSERT INTO tournament_leaderboards (
        tournament_id, player_id, player_name, score, rank, is_final
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    return await this.db.query(query, [
      tournamentId, playerId, playerName, score, rank, isFinal
    ]);
  }

  async _logTournamentEvent(tournamentId, eventType, eventData = {}) {
    const query = `
      INSERT INTO tournament_events (tournament_id, event_type, event_data)
      VALUES ($1, $2, $3)
      RETURNING id
    `;

    return await this.db.query(query, [
      tournamentId, eventType, JSON.stringify(eventData)
    ]);
  }

  /**
   * Unified tournament session handler
   * Handles registration, score submission, and state retrieval in one optimized call
   */
  async handleTournamentSession(sessionData) {
    try {
      const { tournamentId, playerId, playerName, action, score, gameData } = sessionData;

      // Step 1: Get current tournament (resolve 'current' if needed)
      let actualTournamentId = tournamentId;
      if (tournamentId === 'current') {
        const currentResult = await this.getCurrentTournament();
        if (!currentResult.success || !currentResult.tournament) {
          return {
            success: false,
            error: 'No active tournament available'
          };
        }
        actualTournamentId = currentResult.tournament.id;
      }

      // Step 2: Get tournament details
      const tournament = await this._getTournamentById(actualTournamentId);
      if (!tournament) {
        return {
          success: false,
          error: 'Tournament not found'
        };
      }

      // Step 3: Check/ensure player registration
      let playerRegistration = await this._getPlayerRegistration(actualTournamentId, playerId);
      let justRegistered = false;

      if (!playerRegistration) {
        // Auto-register player if tournament allows it
        if (tournament.status === 'upcoming' || tournament.status === 'registration' || tournament.status === 'active') {
          const registerResult = await this.registerPlayer(actualTournamentId, {
            playerId,
            playerName
          });
          
          if (registerResult.success) {
            playerRegistration = await this._getPlayerRegistration(actualTournamentId, playerId);
            justRegistered = true;
          } else {
            return {
              success: false,
              error: `Registration failed: ${registerResult.error}`
            };
          }
        } else {
          return {
            success: false,
            error: 'Tournament registration is closed'
          };
        }
      }

      // Step 4: Handle score submission if requested
      let scoreSubmissionResult = null;
      if (action === 'submit_score' && score !== undefined) {
        const submitResult = await this.submitScore(actualTournamentId, {
          playerId,
          score,
          gameData
        });
        
        if (submitResult.success) {
          scoreSubmissionResult = {
            accepted: true,
            newBest: submitResult.newBest,
            score: submitResult.score,
            previousBest: submitResult.previousBest,
            rankImprovement: submitResult.previousRank ? (submitResult.previousRank - submitResult.rank) : 0
          };
          
          // Refresh player registration to get updated stats
          playerRegistration = await this._getPlayerRegistration(actualTournamentId, playerId);
        } else {
          scoreSubmissionResult = {
            accepted: false,
            error: submitResult.error
          };
        }
      }

      // Step 5: Get current rank and leaderboard context
      const playerRank = await this._getPlayerRank(actualTournamentId, playerId);
      const leaderboard = await this._getTournamentLeaderboard(actualTournamentId, {
        limit: 10,
        offset: 0
      });

      // Step 6: Build comprehensive response
      return {
        success: true,
        tournament: {
          id: tournament.id,
          name: tournament.name,
          status: tournament.status,
          endsAt: tournament.ends_at ? tournament.ends_at.toISOString() : null,
          prizePool: tournament.prize_pool
        },
        player: {
          registered: true,
          rank: playerRank,
          bestScore: playerRegistration.best_score || 0,
          totalGames: playerRegistration.total_games || 0,
          justRegistered
        },
        scoreSubmission: scoreSubmissionResult,
        leaderboard: leaderboard.map(entry => ({
          rank: entry.rank,
          playerName: entry.player_name,
          score: entry.score
        }))
      };

    } catch (error) {
      logger.error('Error in handleTournamentSession:', error);
      return {
        success: false,
        error: 'Tournament session failed'
      };
    }
  }

  /**
   * Get player registration for a tournament
   */
  async _getPlayerRegistration(tournamentId, playerId) {
    try {
      const query = `
        SELECT * FROM tournament_participants 
        WHERE tournament_id = $1 AND player_id = $2
      `;
      const result = await this.db.query(query, [tournamentId, playerId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting player registration:', error);
      return null;
    }
  }

  /**
   * Get tournament by ID
   */
  async _getTournamentById(tournamentId) {
    try {
      const query = `
        SELECT * FROM tournaments 
        WHERE id = $1
      `;
      const result = await this.db.query(query, [tournamentId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting tournament by ID:', error);
      return null;
    }
  }
}

module.exports = TournamentManager;
