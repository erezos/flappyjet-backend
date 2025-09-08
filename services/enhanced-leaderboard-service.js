/**
 * 🏆 Enhanced Leaderboard Service
 * Production-ready leaderboard with caching, anti-cheat, and performance optimization
 */

const { v4: uuidv4 } = require('uuid');
const { AntiCheatEngine } = require('./anti-cheat-engine');
const { CacheManager } = require('./cache-manager');
const logger = require('../utils/logger');

class EnhancedLeaderboardService {
  constructor(database, redis) {
    this.db = database;
    this.redis = redis;
    this.cache = new CacheManager(redis);
    this.antiCheat = new AntiCheatEngine(database);
    
    // Cache TTL configurations (in seconds)
    this.cacheTTL = {
      global: 300,      // 5 minutes
      weekly: 180,      // 3 minutes
      monthly: 600,     // 10 minutes
      player: 120,      // 2 minutes
      stats: 900        // 15 minutes
    };
  }

  /**
   * Submit a score with comprehensive validation and anti-cheat
   */
  async submitScore(playerId, scoreData) {
    try {
      // 1. Get player's recent scores for anti-cheat analysis
      const recentScores = await this._getRecentScores(playerId, 10);

      // 2. Run anti-cheat validation (includes basic data validation)
      const antiCheatResult = await this.antiCheat.validateScore(playerId, scoreData, recentScores);
      if (!antiCheatResult.isValid) {
        throw new Error(`Anti-cheat violation: ${antiCheatResult.reason}`);
      }

      // 4. Check if this is a personal best
      const currentBest = await this._getPlayerBestScore(playerId);
      const isPersonalBest = !currentBest || scoreData.score > currentBest.score;

      // 5. Insert score into database
      const scoreId = await this._insertScore(playerId, scoreData);

      // 6. Calculate player's new rank
      const rank = await this._calculatePlayerRank(playerId, scoreData.score);

      // 7. Invalidate relevant caches
      await this._invalidateLeaderboardCaches();

      // 8. Return success response
      return {
        success: true,
        scoreId,
        rank,
        isPersonalBest,
        coinsEarned: scoreData.coinsEarned || 0,
        gemsEarned: scoreData.gemsEarned || 0,
        submittedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('🚂 ❌ Score submission failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch global leaderboard with caching and pagination
   */
  async getGlobalLeaderboard(options = {}) {
    const {
      limit = 100,
      offset = 0,
      period = 'all_time',
      includeStats = false
    } = options;

    try {
      // Generate cache key
      const cacheKey = `leaderboard:global:${period}:${limit}:${offset}:${includeStats}`;
      
      // Try to get from cache first
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }

      // Build query based on period
      const whereClause = this._buildPeriodWhereClause(period);
      
      // Get leaderboard data
      const leaderboardQuery = `
        SELECT 
          s.id,
          s.player_id,
          p.nickname,
          s.score,
          s.survival_time,
          s.skin_used,
          s.theme,
          s.achieved_at,
          ROW_NUMBER() OVER (ORDER BY s.score DESC, s.achieved_at ASC) as rank
        FROM scores s
        JOIN players p ON s.player_id = p.id
        ${whereClause}
        ORDER BY s.score DESC, s.achieved_at ASC
        LIMIT $1 OFFSET $2
      `;

      const leaderboardResult = await this.db.query(leaderboardQuery, [limit, offset]);

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(DISTINCT s.player_id) as total
        FROM scores s
        ${whereClause}
      `;
      const countResult = await this.db.query(countQuery);
      const total = parseInt(countResult.rows[0].total);

      // Format leaderboard entries
      const leaderboard = leaderboardResult.rows.map((row, index) => ({
        rank: offset + index + 1,
        player_id: row.player_id,
        nickname: row.nickname || 'Anonymous',
        score: row.score,
        survival_time: row.survival_time,
        skin_used: row.skin_used,
        theme: row.theme,
        achieved_at: row.achieved_at.toISOString(),
        isCurrentPlayer: false // Will be set by client
      }));

      // Build pagination info
      const pagination = {
        limit,
        offset,
        total,
        hasMore: offset + limit < total
      };

      // Get statistics if requested
      let stats = null;
      if (includeStats) {
        stats = await this._getLeaderboardStats(period);
      }

      const response = {
        success: true,
        leaderboard,
        pagination,
        stats,
        period,
        fetchedAt: new Date().toISOString()
      };

      // Cache the response
      const ttl = this.cacheTTL[period] || this.cacheTTL.global;
      await this.cache.set(cacheKey, response, ttl);

      return response;

    } catch (error) {
      logger.error('🚂 ❌ Failed to fetch global leaderboard:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get player's leaderboard context (rank and surrounding players)
   */
  async getPlayerContext(playerId, period = 'all_time', contextSize = 5) {
    try {
      // Get player's best score and rank
      const playerRankQuery = `
        WITH ranked_scores AS (
          SELECT 
            s.player_id,
            s.score,
            s.achieved_at,
            ROW_NUMBER() OVER (ORDER BY s.score DESC, s.achieved_at ASC) as rank
          FROM scores s
          ${this._buildPeriodWhereClause(period)}
        )
        SELECT rank, score, achieved_at
        FROM ranked_scores
        WHERE player_id = $1
        ORDER BY score DESC
        LIMIT 1
      `;

      const playerResult = await this.db.query(playerRankQuery, [playerId]);
      
      if (playerResult.rows.length === 0) {
        return {
          success: false,
          error: 'Player not found in leaderboard'
        };
      }

      const playerRank = parseInt(playerResult.rows[0].rank);
      const playerScore = playerResult.rows[0].score;

      // Get context around player's rank
      const contextStart = Math.max(1, playerRank - contextSize);
      const contextEnd = playerRank + contextSize;

      const contextQuery = `
        WITH ranked_scores AS (
          SELECT 
            s.player_id,
            p.nickname,
            s.score,
            s.survival_time,
            s.skin_used,
            s.achieved_at,
            ROW_NUMBER() OVER (ORDER BY s.score DESC, s.achieved_at ASC) as rank
          FROM scores s
          JOIN players p ON s.player_id = p.id
          ${this._buildPeriodWhereClause(period)}
        )
        SELECT *
        FROM ranked_scores
        WHERE rank BETWEEN $1 AND $2
        ORDER BY rank
      `;

      const contextResult = await this.db.query(contextQuery, [contextStart, contextEnd]);

      const context = contextResult.rows.map(row => ({
        rank: parseInt(row.rank),
        player_id: row.player_id,
        nickname: row.nickname || 'Anonymous',
        score: row.score,
        survival_time: row.survival_time,
        skin_used: row.skin_used,
        achieved_at: row.achieved_at ? row.achieved_at.toISOString() : new Date().toISOString(),
        isCurrentPlayer: row.player_id === playerId || row.isCurrentPlayer === true
      }));

      return {
        success: true,
        playerRank,
        playerScore,
        context,
        period
      };

    } catch (error) {
      logger.error('🚂 ❌ Failed to fetch player context:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get leaderboard statistics
   */
  async getLeaderboardStats(period = 'all_time') {
    try {
      const cacheKey = `leaderboard:stats:${period}`;
      
      // Try cache first
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const stats = await this._getLeaderboardStats(period);
      
      // Cache for longer since stats change less frequently
      await this.cache.set(cacheKey, stats, this.cacheTTL.stats);
      
      return stats;

    } catch (error) {
      logger.error('🚂 ❌ Failed to fetch leaderboard stats:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Private helper methods

  _validateScoreData(scoreData) {
    if (!scoreData || typeof scoreData !== 'object') {
      throw new Error('Invalid score data: must be an object');
    }

    const { score, survivalTime, gameDuration } = scoreData;

    // Validate score
    if (typeof score !== 'number' || score < 0) {
      throw new Error('Invalid score: must be a non-negative number');
    }

    if (score > 100000) {
      throw new Error('Invalid score: exceeds maximum allowed value');
    }

    // Validate survival time
    if (survivalTime !== undefined && (typeof survivalTime !== 'number' || survivalTime < 0)) {
      throw new Error('Invalid survival time: must be a non-negative number');
    }

    // Validate game duration
    if (gameDuration !== undefined && (typeof gameDuration !== 'number' || gameDuration < 1000)) {
      throw new Error('Invalid game duration: must be at least 1 second');
    }

    // Basic anti-cheat: score-to-time ratio
    if (survivalTime && survivalTime > 0) {
      const scorePerSecond = score / (survivalTime / 1000);
      if (scorePerSecond > 10) {
        throw new Error('Invalid score-to-time ratio detected');
      }
    }
  }

  async _getRecentScores(playerId, limit = 10) {
    const query = `
      SELECT score, survival_time, achieved_at
      FROM scores
      WHERE player_id = $1
      ORDER BY achieved_at DESC
      LIMIT $2
    `;
    
    const result = await this.db.query(query, [playerId, limit]);
    return result.rows;
  }

  async _getPlayerBestScore(playerId) {
    const query = `
      SELECT score, achieved_at
      FROM scores
      WHERE player_id = $1
      ORDER BY score DESC
      LIMIT 1
    `;
    
    const result = await this.db.query(query, [playerId]);
    return result.rows[0] || null;
  }

  async _insertScore(playerId, scoreData) {
    const scoreId = uuidv4();
    
    const query = `
      INSERT INTO scores (
        id, player_id, score, survival_time, skin_used, coins_earned,
        gems_earned, game_duration, theme, platform, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;

    const values = [
      scoreId,
      playerId,
      scoreData.score,
      scoreData.survivalTime || null,
      scoreData.skinUsed || 'sky_jet',
      scoreData.coinsEarned || 0,
      scoreData.gemsEarned || 0,
      scoreData.gameDuration || null,
      scoreData.theme || 'Sky Rookie',
      scoreData.platform || 'unknown',
      scoreData.version || '1.0.0'
    ];

    const result = await this.db.query(query, values);
    return result.rows[0].id;
  }

  async _calculatePlayerRank(playerId, score) {
    const query = `
      SELECT COUNT(*) + 1 as rank
      FROM scores s1
      WHERE s1.score > $1
      OR (s1.score = $1 AND s1.achieved_at < (
        SELECT s2.achieved_at 
        FROM scores s2 
        WHERE s2.player_id = $2 AND s2.score = $1 
        ORDER BY s2.achieved_at DESC 
        LIMIT 1
      ))
    `;

    const result = await this.db.query(query, [score, playerId]);
    return parseInt(result.rows[0].rank);
  }

  _buildPeriodWhereClause(period) {
    switch (period) {
      case 'daily':
        return "WHERE s.achieved_at >= NOW() - INTERVAL '1 day'";
      case 'weekly':
        return "WHERE s.achieved_at >= NOW() - INTERVAL '1 week'";
      case 'monthly':
        return "WHERE s.achieved_at >= NOW() - INTERVAL '1 month'";
      case 'all_time':
      default:
        return '';
    }
  }

  async _getLeaderboardStats(period) {
    const whereClause = this._buildPeriodWhereClause(period);
    
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT s.player_id) as total_players,
        COUNT(*) as total_scores,
        AVG(s.score) as average_score,
        MAX(s.score) as highest_score,
        MAX(s.achieved_at) as last_updated
      FROM scores s
      ${whereClause}
    `;

    const result = await this.db.query(statsQuery);
    const stats = result.rows[0];

    return {
      totalPlayers: parseInt(stats.total_players),
      totalScores: parseInt(stats.total_scores),
      averageScore: parseFloat(stats.average_score) || 0,
      highestScore: parseInt(stats.highest_score) || 0,
      lastUpdated: stats.last_updated ? stats.last_updated.toISOString() : new Date().toISOString()
    };
  }

  async _invalidateLeaderboardCaches() {
    const patterns = [
      'leaderboard:global:*',
      'leaderboard:stats:*',
      'leaderboard:player:*'
    ];

    for (const pattern of patterns) {
      await this.cache.deletePattern(pattern);
    }
  }
}

module.exports = { EnhancedLeaderboardService };
