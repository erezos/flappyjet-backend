/**
 * Prize Calculator Service
 * Calculates and awards tournament prizes
 * 
 * This service:
 * 1. Runs via cron on Monday 00:05 UTC (after tournament ends)
 * 2. Calculates top 50 winners from tournament leaderboard
 * 3. Generates prize entries in database
 * 4. Flutter app polls /api/v2/prizes/pending to check for prizes
 * 
 * Prize Pool (from BACKEND_API_SPECIFICATION.md):
 * - Rank 1:      5000 coins + 250 gems
 * - Rank 2:      3000 coins + 150 gems
 * - Rank 3:      2000 coins + 100 gems
 * - Rank 4-10:   1000 coins + 50 gems
 * - Rank 11-50:   500 coins + 25 gems
 */

const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class PrizeCalculator {
  constructor(db) {
    this.db = db;
    this.stats = {
      tournaments_processed: 0,
      total_prizes_awarded: 0,
      last_calculation: null,
    };
  }

  /**
   * Calculate and award prizes for a completed tournament
   * Called by cron on Monday 00:05 UTC
   * @param {string} tournamentId - Tournament identifier
   * @param {string} tournamentName - Tournament name for display
   * @returns {Promise<Object>} - { success, prizes_awarded, details }
   */
  async calculateTournamentPrizes(tournamentId, tournamentName) {
    const startTime = Date.now();
    
    try {
      logger.info('🏆 Starting prize calculation', { tournamentId, tournamentName });

      // 1. Get top 50 players from tournament leaderboard
      const winners = await this.db.query(`
        SELECT 
          user_id,
          nickname,
          best_score,
          ROW_NUMBER() OVER (ORDER BY best_score DESC, last_attempt_at DESC) as rank
        FROM tournament_leaderboard
        WHERE tournament_id = $1
        ORDER BY best_score DESC, last_attempt_at DESC
        LIMIT 50
      `, [tournamentId]);

      if (winners.rows.length === 0) {
        logger.warn('⚠️ No participants in tournament', { tournamentId });
        return { 
          success: true, 
          prizes_awarded: 0,
          message: 'No participants'
        };
      }

      logger.info(`📊 Found ${winners.rows.length} winners in tournament ${tournamentId}`);

      // 2. Prize distribution tiers
      const prizePool = this.getPrizePool();

      let prizesAwarded = 0;
      const prizeDetails = [];

      // 3. Award prizes to each winner
      for (const winner of winners.rows) {
        const rank = parseInt(winner.rank);
        const user_id = winner.user_id;
        const nickname = winner.nickname || 'Pilot';

        // Find prize tier for this rank
        const prize = this.getPrizeForRank(rank, prizePool);

        if (!prize) {
          logger.debug('No prize for rank', { rank, user_id });
          continue;
        }

        // Generate unique prize ID
        const prize_id = `prize_${tournamentId}_${user_id}_${Date.now()}`;

        // Check if prize already awarded (prevent duplicates)
        const existing = await this.db.query(
          'SELECT 1 FROM prizes WHERE tournament_id = $1 AND user_id = $2',
          [tournamentId, user_id]
        );

        if (existing.rows.length > 0) {
          logger.warn('⚠️ Prize already awarded, skipping', { 
            tournament_id: tournamentId, 
            user_id 
          });
          continue;
        }

        // Insert prize entry
        await this.db.query(`
          INSERT INTO prizes (
            prize_id,
            user_id,
            tournament_id,
            tournament_name,
            rank,
            coins,
            gems,
            awarded_at,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        `, [
          prize_id,
          user_id,
          tournamentId,
          tournamentName,
          rank,
          prize.coins,
          prize.gems
        ]);

        prizesAwarded++;
        prizeDetails.push({
          user_id,
          nickname,
          rank,
          coins: prize.coins,
          gems: prize.gems
        });

        logger.info('🎁 Prize awarded', { 
          prize_id, 
          user_id, 
          nickname,
          rank, 
          coins: prize.coins, 
          gems: prize.gems 
        });
      }

      // 4. Update stats
      this.stats.tournaments_processed++;
      this.stats.total_prizes_awarded += prizesAwarded;
      this.stats.last_calculation = new Date();

      const duration = Date.now() - startTime;

      logger.info('✅ Tournament prizes calculated', { 
        tournamentId,
        participants: winners.rows.length, 
        prizes_awarded: prizesAwarded,
        duration_ms: duration
      });

      return {
        success: true,
        tournament_id: tournamentId,
        tournament_name: tournamentName,
        participants: winners.rows.length,
        prizes_awarded: prizesAwarded,
        prize_details: prizeDetails,
        duration_ms: duration
      };

    } catch (error) {
      logger.error('💥 Error calculating tournament prizes', { 
        error: error.message,
        stack: error.stack,
        tournamentId 
      });
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get prize pool configuration
   * @returns {Array} - Prize tiers
   */
  getPrizePool() {
    return [
      { ranks: [1], coins: 5000, gems: 250 },
      { ranks: [2], coins: 3000, gems: 150 },
      { ranks: [3], coins: 2000, gems: 100 },
      { ranks: [4, 5, 6, 7, 8, 9, 10], coins: 1000, gems: 50 },
      { 
        ranks: Array.from({ length: 40 }, (_, i) => i + 11), // 11-50
        coins: 500, 
        gems: 25 
      }
    ];
  }

  /**
   * Get prize for a specific rank
   * @param {number} rank - Player's rank
   * @param {Array} prizePool - Prize pool configuration
   * @returns {Object|null} - Prize object or null
   */
  getPrizeForRank(rank, prizePool) {
    for (const tier of prizePool) {
      if (tier.ranks.includes(rank)) {
        return { coins: tier.coins, gems: tier.gems };
      }
    }
    return null;
  }

  /**
   * Process last week's tournament prizes
   * Finds the most recent completed tournament and calculates prizes
   * @returns {Promise<Object>}
   */
  async processLastWeekPrizes() {
    try {
      logger.info('🔍 Looking for tournaments needing prize calculation...');

      // Get the most recent tournament that ended but hasn't had prizes calculated
      // This assumes tournaments table exists (from old system)
      // If not, we use a simpler approach based on tournament_leaderboard table

      // Try to get from tournaments table first
      let tournament = null;
      
      try {
        const result = await this.db.query(`
          SELECT tournament_id, name, end_date
          FROM tournaments
          WHERE end_date < NOW()
            AND status = 'completed'
            AND (prizes_calculated IS NULL OR prizes_calculated = false)
          ORDER BY end_date DESC
          LIMIT 1
        `);

        if (result.rows.length > 0) {
          tournament = result.rows[0];
        }
      } catch (error) {
        logger.warn('⚠️ tournaments table not found, using fallback method');
      }

      // Fallback: Find most recent tournament from leaderboard table
      if (!tournament) {
        // Get the most recent tournament_id from tournament_leaderboard
        const fallback = await this.db.query(`
          SELECT 
            tournament_id,
            MAX(last_attempt_at) as last_game
          FROM tournament_leaderboard
          GROUP BY tournament_id
          HAVING MAX(last_attempt_at) < NOW() - INTERVAL '1 day'
          ORDER BY MAX(last_attempt_at) DESC
          LIMIT 1
        `);

        if (fallback.rows.length > 0) {
          tournament = {
            tournament_id: fallback.rows[0].tournament_id,
            name: `Weekly Championship ${fallback.rows[0].tournament_id}`,
            end_date: fallback.rows[0].last_game
          };
        }
      }

      if (!tournament) {
        logger.info('✅ No tournaments needing prize calculation');
        return { 
          success: true, 
          message: 'No tournaments to process' 
        };
      }

      logger.info('🏆 Found tournament for prize calculation', { 
        tournament_id: tournament.tournament_id,
        name: tournament.name 
      });

      // Calculate prizes
      const result = await this.calculateTournamentPrizes(
        tournament.tournament_id,
        tournament.name
      );

      // Mark tournament as prizes calculated (if tournaments table exists)
      if (result.success) {
        try {
          await this.db.query(`
            UPDATE tournaments
            SET prizes_calculated = true,
                prizes_calculated_at = NOW()
            WHERE tournament_id = $1
          `, [tournament.tournament_id]);
        } catch (error) {
          logger.debug('tournaments table not found, skipping update');
        }
      }

      return result;

    } catch (error) {
      logger.error('💥 Error processing last week prizes', { 
        error: error.message,
        stack: error.stack 
      });
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get calculator statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      last_calculation_ago_hours: this.stats.last_calculation
        ? Math.floor((Date.now() - this.stats.last_calculation.getTime()) / 3600000)
        : null
    };
  }

  /**
   * Manually trigger prize calculation for a specific tournament
   * Useful for testing or manual intervention
   * @param {string} tournamentId - Tournament identifier
   * @param {string} tournamentName - Tournament name
   * @returns {Promise<Object>}
   */
  async manualCalculation(tournamentId, tournamentName) {
    logger.warn('⚠️ MANUAL prize calculation triggered', { tournamentId, tournamentName });
    return await this.calculateTournamentPrizes(tournamentId, tournamentName);
  }

  /**
   * Recalculate prizes for a tournament (delete old ones first)
   * WARNING: Use with caution! This will delete existing prizes
   * @param {string} tournamentId - Tournament identifier
   * @returns {Promise<Object>}
   */
  async recalculatePrizes(tournamentId) {
    try {
      logger.warn('⚠️ RECALCULATING prizes (deleting old ones)', { tournamentId });

      // Delete existing prizes
      const deleted = await this.db.query(
        'DELETE FROM prizes WHERE tournament_id = $1 AND claimed_at IS NULL RETURNING prize_id',
        [tournamentId]
      );

      logger.info(`🗑️ Deleted ${deleted.rows.length} unclaimed prizes`);

      // Get tournament name
      const nameResult = await this.db.query(
        'SELECT name FROM tournaments WHERE tournament_id = $1',
        [tournamentId]
      );

      const tournamentName = nameResult.rows.length > 0 
        ? nameResult.rows[0].name 
        : `Tournament ${tournamentId}`;

      // Recalculate
      const result = await this.calculateTournamentPrizes(tournamentId, tournamentName);

      return {
        success: true,
        deleted_prizes: deleted.rows.length,
        ...result
      };

    } catch (error) {
      logger.error('💥 Error recalculating prizes', { 
        error: error.message,
        tournamentId 
      });
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}

module.exports = PrizeCalculator;

