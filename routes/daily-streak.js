const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * 🎯 Enhanced Daily Streak Management API
 * Handles cycle-aware streak management with proper validation
 */

// Get database connection from app locals
const getDb = (req) => req.app.locals.db;

/**
 * Claim today's daily streak reward
 * POST /api/daily-streak/claim
 */
router.post('/claim', authenticateToken, async (req, res) => {
  const db = getDb(req);
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    const playerId = req.user.playerId;
    const today = new Date().toISOString().split('T')[0];
    
    logger.info(`🎯 Daily streak claim attempt: ${playerId} on ${today}`);
    
    // Get current streak data
    const streakResult = await client.query(
      `SELECT current_streak, current_cycle, last_claim_date, 
              cycle_start_date, total_cycles_completed, cycle_reward_set
       FROM daily_streaks WHERE player_id = $1`,
      [playerId]
    );
    
    let streakData;
    let isNewStreak = false;
    
    if (streakResult.rows.length === 0) {
      // Create new streak record
      const rewardSet = await client.query(
        'SELECT determine_reward_set($1) as reward_set',
        [playerId]
      );
      
      await client.query(
        `INSERT INTO daily_streaks (player_id, current_streak, current_cycle, 
                                   last_claim_date, cycle_start_date, cycle_reward_set)
         VALUES ($1, 1, 0, $2, $2, $3)`,
        [playerId, today, rewardSet.rows[0].reward_set]
      );
      
      streakData = {
        current_streak: 1,
        current_cycle: 0,
        last_claim_date: today,
        cycle_start_date: today,
        total_cycles_completed: 0,
        cycle_reward_set: rewardSet.rows[0].reward_set
      };
      isNewStreak = true;
      
      logger.info(`🎯 New streak started: ${playerId} with ${streakData.cycle_reward_set} rewards`);
    } else {
      streakData = streakResult.rows[0];
      
      // Validate claim eligibility
      if (streakData.last_claim_date === today) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false, 
          message: 'Already claimed today',
          code: 'ALREADY_CLAIMED'
        });
      }
      
      // Check if streak is broken
      const daysSinceLastClaim = Math.floor(
        (new Date(today) - new Date(streakData.last_claim_date)) / (1000 * 60 * 60 * 24)
      );
      
      let newStreak = streakData.current_streak;
      let newCycle = streakData.current_cycle;
      let cycleCompleted = false;
      let streakBroken = false;
      
      if (daysSinceLastClaim > 1) {
        // Streak broken - reset to 1
        newStreak = 1;
        newCycle = 0;
        streakBroken = true;
        
        // Determine new reward set
        const rewardSetResult = await client.query(
          'SELECT determine_reward_set($1) as reward_set',
          [playerId]
        );
        streakData.cycle_reward_set = rewardSetResult.rows[0].reward_set;
        
        logger.info(`🎯 Streak broken: ${playerId} (missed ${daysSinceLastClaim} days), resetting`);
      } else {
        // Continue streak
        newStreak = streakData.current_streak + 1;
        
        // Check for cycle completion
        if (newStreak % 7 === 0) {
          cycleCompleted = true;
          newCycle = streakData.current_cycle + 1;
          newStreak = 0; // Reset for new cycle
          
          logger.info(`🎯 Cycle completed: ${playerId} (cycle ${streakData.current_cycle} -> ${newCycle})`);
        }
      }
      
      // Validate progression
      const isValidProgression = await client.query(
        'SELECT validate_streak_progression($1, $2, $3) as is_valid',
        [playerId, newStreak, newCycle]
      );
      
      if (!isValidProgression.rows[0].is_valid) {
        await client.query('ROLLBACK');
        logger.error(`🎯 Invalid streak progression: ${playerId} (${streakData.current_streak} -> ${newStreak})`);
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid streak progression',
          code: 'INVALID_PROGRESSION'
        });
      }
      
      // Update streak data
      await client.query(
        `UPDATE daily_streaks SET 
           current_streak = $1,
           current_cycle = $2,
           last_claim_date = $3,
           cycle_start_date = CASE WHEN $4 THEN $3 ELSE cycle_start_date END,
           last_cycle_completion_date = CASE WHEN $4 THEN $3 ELSE last_cycle_completion_date END,
           total_cycles_completed = CASE WHEN $4 THEN total_cycles_completed + 1 ELSE total_cycles_completed END,
           cycle_reward_set = CASE WHEN $5 THEN $6 ELSE cycle_reward_set END,
           updated_at = NOW()
         WHERE player_id = $7`,
        [newStreak, newCycle, today, cycleCompleted, streakBroken, streakData.cycle_reward_set, playerId]
      );
      
      // Log cycle completion
      if (cycleCompleted) {
        await client.query(
          `INSERT INTO daily_streak_cycles (player_id, cycle_number, start_date, completion_date, reward_set)
           VALUES ($1, $2, $3, $4, $5)`,
          [playerId, streakData.current_cycle, streakData.cycle_start_date, today, streakData.cycle_reward_set]
        );
        
        // Log cycle completion analytics
        logger.info(`🎯 Cycle completion logged: ${playerId} completed cycle ${streakData.current_cycle} with ${streakData.cycle_reward_set} rewards`);
      }
      
      // Update streak data for response
      streakData.current_streak = newStreak;
      streakData.current_cycle = newCycle;
    }
    
    await client.query('COMMIT');
    
    // Determine response message
    let message;
    if (isNewStreak) {
      message = 'Welcome! Your daily streak journey begins!';
    } else if (cycleCompleted) {
      message = `Cycle completed! Starting new cycle with ${streakData.cycle_reward_set} rewards!`;
    } else if (streakBroken) {
      message = 'Streak broken, but you can start fresh!';
    } else {
      message = 'Streak updated! Keep it going!';
    }
    
    res.json({
      success: true,
      streak: streakData.current_streak,
      cycle: streakData.current_cycle,
      cycleRewardSet: streakData.cycle_reward_set,
      cycleCompleted: cycleCompleted,
      streakBroken: streakBroken,
      message: message,
      analytics: {
        totalCyclesCompleted: streakData.total_cycles_completed,
        lastClaimDate: streakData.last_claim_date,
        cycleStartDate: streakData.cycle_start_date
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('🎯 Error claiming daily streak:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  } finally {
    client.release();
  }
});

/**
 * Get daily streak analytics for a player
 * GET /api/daily-streak/analytics
 */
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;
    const db = getDb(req);
    
    const analytics = await db.query(`
      SELECT 
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
        AVG(EXTRACT(DAYS FROM (dsc.completion_date - dsc.start_date))) as avg_cycle_duration,
        MAX(dsc.completion_date) as last_completed_cycle_date
      FROM daily_streaks ds
      LEFT JOIN daily_streak_cycles dsc ON ds.player_id = dsc.player_id
      WHERE ds.player_id = $1
      GROUP BY ds.player_id, ds.current_streak, ds.current_cycle, 
               ds.cycle_reward_set, ds.total_cycles_completed, ds.last_claim_date, 
               ds.cycle_start_date, ds.last_cycle_completion_date, ds.max_streak, ds.total_claims
    `, [playerId]);
    
    if (analytics.rows.length === 0) {
      return res.json({
        success: true,
        analytics: {
          current_streak: 0,
          current_cycle: 0,
          cycle_reward_set: 'new_player',
          total_cycles_completed: 0,
          cycles_completed_count: 0,
          avg_cycle_duration: 0
        }
      });
    }
    
    res.json({
      success: true,
      analytics: analytics.rows[0]
    });
    
  } catch (error) {
    logger.error('🎯 Error fetching streak analytics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

/**
 * Get daily streak status (for UI display)
 * GET /api/daily-streak/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;
    const today = new Date().toISOString().split('T')[0];
    const db = getDb(req);
    
    const status = await db.query(`
      SELECT 
        ds.current_streak,
        ds.current_cycle,
        ds.cycle_reward_set,
        ds.last_claim_date,
        ds.cycle_start_date,
        CASE 
          WHEN ds.last_claim_date = $2 THEN 'claimed'
          WHEN ds.last_claim_date IS NULL THEN 'available'
          WHEN EXTRACT(DAYS FROM ($2::date - ds.last_claim_date)) = 1 THEN 'available'
          ELSE 'expired'
        END as state
      FROM daily_streaks ds
      WHERE ds.player_id = $1
    `, [playerId, today]);
    
    if (status.rows.length === 0) {
      return res.json({
        success: true,
        status: {
          currentStreak: 0,
          currentCycle: 0,
          cycleRewardSet: 'new_player',
          state: 'available',
          lastClaimDate: null,
          cycleStartDate: null
        }
      });
    }
    
    const data = status.rows[0];
    res.json({
      success: true,
      status: {
        currentStreak: data.current_streak,
        currentCycle: data.current_cycle,
        cycleRewardSet: data.cycle_reward_set,
        state: data.state,
        lastClaimDate: data.last_claim_date,
        cycleStartDate: data.cycle_start_date
      }
    });
    
  } catch (error) {
    logger.error('🎯 Error fetching streak status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

/**
 * Reset daily streak (for testing/debugging)
 * POST /api/daily-streak/reset
 */
router.post('/reset', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;
    const db = getDb(req);
    
    await db.query(
      'DELETE FROM daily_streaks WHERE player_id = $1',
      [playerId]
    );
    
    await db.query(
      'DELETE FROM daily_streak_cycles WHERE player_id = $1',
      [playerId]
    );
    
    logger.info(`🎯 Daily streak reset: ${playerId}`);
    
    res.json({
      success: true,
      message: 'Daily streak reset successfully'
    });
    
  } catch (error) {
    logger.error('🎯 Error resetting daily streak:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

module.exports = router;
