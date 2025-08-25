/**
 * Prize Manager Service
 * Handles prize distribution for tournament winners
 */

const { v4: uuidv4 } = require('uuid');

class PrizeManager {
  constructor({ db, wsManager }) {
    this.db = db;
    this.wsManager = wsManager;
  }

  /**
   * Distribute prizes to tournament winners
   */
  async distributePrizes(tournamentId, leaderboard, prizeDistribution, totalPrizePool) {
    try {
      const distributions = [];
      let totalDistributed = 0;

      // Calculate prize amounts for each position
      for (const entry of leaderboard) {
        const rank = entry.rank;
        const percentage = prizeDistribution[rank.toString()];
        
        if (percentage && percentage > 0) {
          const prizeAmount = Math.floor(totalPrizePool * percentage);
          
          if (prizeAmount > 0) {
            // Credit player account
            const creditResult = await this.creditPlayerAccount(
              entry.player_id, 
              prizeAmount, 
              `Tournament prize - Rank ${rank}`,
              tournamentId
            );

            if (creditResult.success) {
              // Update tournament participant record
              await this._updateParticipantPrize(tournamentId, entry.player_id, rank, prizeAmount);

              distributions.push({
                playerId: entry.player_id,
                playerName: entry.player_name,
                rank: rank,
                amount: prizeAmount,
                percentage: percentage
              });

              totalDistributed += prizeAmount;

              // Notify player via WebSocket
              if (this.wsManager) {
                await this.wsManager.notifyPlayer(entry.player_id, {
                  type: 'prize_won',
                  tournamentId: tournamentId,
                  rank: rank,
                  prizeAmount: prizeAmount,
                  message: `Congratulations! You won ${prizeAmount} gems for finishing ${this._getOrdinal(rank)}!`
                });
              }

              // Log prize distribution
              await this._logPrizeDistribution(tournamentId, entry.player_id, rank, prizeAmount);
            }
          }
        }
      }

      return {
        success: true,
        distributions: distributions,
        totalDistributed: totalDistributed
      };

    } catch (error) {
      console.error('Error distributing prizes:', error);
      return {
        success: false,
        error: 'Prize distribution failed: ' + error.message
      };
    }
  }

  /**
   * Credit gems to player account
   */
  async creditPlayerAccount(playerId, amount, reason, tournamentId = null) {
    try {
      // Check if player_accounts table exists, create if not
      await this._ensurePlayerAccountsTable();

      // Get or create player account
      let accountQuery = `
        SELECT id, player_id, gems_balance
        FROM player_accounts 
        WHERE player_id = $1
      `;
      
      let accountResult = await this.db.query(accountQuery, [playerId]);
      
      if (!accountResult.rows.length) {
        // Create new account
        const createQuery = `
          INSERT INTO player_accounts (player_id, gems_balance, coins_balance)
          VALUES ($1, 0, 0)
          RETURNING id, player_id, gems_balance
        `;
        
        accountResult = await this.db.query(createQuery, [playerId]);
      }

      const account = accountResult.rows[0];
      const newBalance = account.gems_balance + amount;

      // Update balance
      const updateQuery = `
        UPDATE player_accounts 
        SET gems_balance = $1, updated_at = NOW()
        WHERE player_id = $2
        RETURNING gems_balance
      `;
      
      const updateResult = await this.db.query(updateQuery, [newBalance, playerId]);

      // Log transaction
      await this._logTransaction(playerId, 'gems', amount, reason, tournamentId);

      return {
        success: true,
        previousBalance: account.gems_balance,
        newBalance: updateResult.rows[0].gems_balance,
        amountCredited: amount
      };

    } catch (error) {
      console.error('Error crediting player account:', error);
      return {
        success: false,
        error: 'Failed to credit account: ' + error.message
      };
    }
  }

  /**
   * Validate prize distribution percentages
   */
  validatePrizeDistribution(prizeDistribution) {
    try {
      const totalPercentage = Object.values(prizeDistribution)
        .reduce((sum, percentage) => sum + percentage, 0);

      if (totalPercentage > 1.0) {
        return {
          valid: false,
          error: 'Prize distribution percentages exceed 100%'
        };
      }

      // Check for negative percentages
      for (const [rank, percentage] of Object.entries(prizeDistribution)) {
        if (percentage < 0) {
          return {
            valid: false,
            error: `Negative percentage for rank ${rank}`
          };
        }
      }

      return {
        valid: true,
        totalPercentage: totalPercentage
      };

    } catch (error) {
      return {
        valid: false,
        error: 'Invalid prize distribution format'
      };
    }
  }

  /**
   * Get player's prize history
   */
  async getPlayerPrizeHistory(playerId, limit = 50) {
    try {
      const query = `
        SELECT 
          t.name as tournament_name,
          tp.final_rank,
          tp.prize_won,
          t.end_date,
          t.tournament_type
        FROM tournament_participants tp
        JOIN tournaments t ON tp.tournament_id = t.id
        WHERE tp.player_id = $1 AND tp.prize_won > 0
        ORDER BY t.end_date DESC
        LIMIT $2
      `;

      const result = await this.db.query(query, [playerId, limit]);

      return {
        success: true,
        prizeHistory: result.rows
      };

    } catch (error) {
      console.error('Error getting player prize history:', error);
      return {
        success: false,
        error: 'Failed to get prize history: ' + error.message
      };
    }
  }

  /**
   * Get tournament prize statistics
   */
  async getTournamentPrizeStats(tournamentId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_winners,
          SUM(tp.prize_won) as total_distributed,
          AVG(tp.prize_won) as average_prize,
          MAX(tp.prize_won) as highest_prize,
          t.prize_pool
        FROM tournament_participants tp
        JOIN tournaments t ON tp.tournament_id = t.id
        WHERE tp.tournament_id = $1 AND tp.prize_won > 0
        GROUP BY t.prize_pool
      `;

      const result = await this.db.query(query, [tournamentId]);

      return {
        success: true,
        stats: result.rows[0] || {
          total_winners: 0,
          total_distributed: 0,
          average_prize: 0,
          highest_prize: 0,
          prize_pool: 0
        }
      };

    } catch (error) {
      console.error('Error getting tournament prize stats:', error);
      return {
        success: false,
        error: 'Failed to get prize stats: ' + error.message
      };
    }
  }

  // Private helper methods

  async _ensurePlayerAccountsTable() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS player_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID UNIQUE NOT NULL,
        gems_balance INTEGER DEFAULT 0,
        coins_balance INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        CONSTRAINT valid_gems_balance CHECK (gems_balance >= 0),
        CONSTRAINT valid_coins_balance CHECK (coins_balance >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_player_accounts_player_id ON player_accounts(player_id);
    `;

    await this.db.query(createTableQuery);
  }

  async _updateParticipantPrize(tournamentId, playerId, rank, prizeAmount) {
    const query = `
      UPDATE tournament_participants 
      SET final_rank = $1, prize_won = $2, prize_claimed = true, prize_claimed_at = NOW()
      WHERE tournament_id = $3 AND player_id = $4
      RETURNING id
    `;

    return await this.db.query(query, [rank, prizeAmount, tournamentId, playerId]);
  }

  async _logTransaction(playerId, currency, amount, reason, tournamentId = null) {
    // Ensure transaction log table exists
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS player_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL,
        transaction_type VARCHAR(50) NOT NULL, -- 'credit', 'debit'
        currency VARCHAR(20) NOT NULL, -- 'gems', 'coins'
        amount INTEGER NOT NULL,
        reason TEXT,
        tournament_id UUID DEFAULT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_player_transactions_player_id ON player_transactions(player_id);
      CREATE INDEX IF NOT EXISTS idx_player_transactions_tournament ON player_transactions(tournament_id);
    `;

    await this.db.query(createTableQuery);

    // Log transaction
    const logQuery = `
      INSERT INTO player_transactions (
        player_id, transaction_type, currency, amount, reason, tournament_id
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    return await this.db.query(logQuery, [
      playerId, 'credit', currency, amount, reason, tournamentId
    ]);
  }

  async _logPrizeDistribution(tournamentId, playerId, rank, amount) {
    const query = `
      INSERT INTO tournament_events (tournament_id, event_type, event_data, player_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;

    const eventData = {
      player_id: playerId,
      rank: rank,
      prize_amount: amount,
      distributed_at: new Date().toISOString()
    };

    return await this.db.query(query, [
      tournamentId, 'prize_distributed', JSON.stringify(eventData), playerId
    ]);
  }

  _getOrdinal(number) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const value = number % 100;
    
    return number + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
  }
}

module.exports = PrizeManager;
