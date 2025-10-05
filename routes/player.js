/**
 * Player Management Routes
 * Handles player profiles, statistics, and validation
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

module.exports = (db) => {
  const router = express.Router();

  // 🛡️ Profanity filter word lists
  const PROFANITY_WORDS = [
    // Basic profanity
    'fuck', 'shit', 'damn', 'bitch', 'ass', 'asshole', 'bastard', 'piss', 'crap',
    'hell', 'bloody', 'fucking', 'shitty', 'damned', 'bitching', 'pissing',
    // Stronger profanity
    'cunt', 'whore', 'slut', 'faggot', 'nigger', 'kike', 'chink', 'spic',
    // Game-specific terms
    'cheat', 'hack', 'exploit', 'glitch', 'spam', 'bot', 'noob', 'nub',
    // Inappropriate content
    'inappropriate', 'offensive', 'racist', 'sexist', 'homophobic'
  ];

  const RESERVED_NAMES = [
    'admin', 'administrator', 'mod', 'moderator', 'system', 'bot', 'ai',
    'flappyjet', 'support', 'help', 'null', 'undefined', 'test', 'demo',
    'guest', 'anonymous', 'user', 'player', 'pilot', 'default',
  ];

  /**
   * 🛡️ Validate nickname - Server-side authoritative validation
   * POST /api/player/validate-nickname
   */
  router.post('/validate-nickname',
    [
      body('nickname')
        .isString()
        .trim()
        .isLength({ min: 2, max: 20 })
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('Nickname must be 2-20 characters, letters, numbers, underscore and hyphen only'),
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({
            success: false,
            error: 'Invalid nickname format',
            errorType: 'invalid_characters',
            details: errors.array()
          });
        }

        const { nickname, clientValidation } = req.body;
        const lowerNickname = nickname.toLowerCase();

        logger.info(`🛡️ Server validating nickname: ${nickname}`);

        // Step 1: Check reserved names
        for (const reserved of RESERVED_NAMES) {
          if (lowerNickname === reserved || lowerNickname.includes(reserved)) {
            logger.info(`🛡️ ❌ Reserved name rejected: ${nickname}`);
            return res.status(400).json({
              success: false,
              error: 'This nickname is reserved',
              errorType: 'reserved',
              suggestion: 'Try adding numbers or modifying the name'
            });
          }
        }

        // Step 2: Advanced profanity checking
        const profanityResult = checkAdvancedProfanity(nickname);
        if (!profanityResult.isClean) {
          logger.info(`🛡️ ❌ Profanity detected: ${nickname} -> ${profanityResult.reason}`);
          return res.status(400).json({
            success: false,
            error: 'Nickname contains inappropriate content',
            errorType: 'profanity',
            suggestion: 'Please choose a different nickname',
            cleanedNickname: profanityResult.cleaned
          });
        }

        // Step 3: Check if nickname is already taken (optional)
        try {
          const existingPlayer = await db.query(
            'SELECT id FROM players WHERE LOWER(nickname) = $1',
            [lowerNickname]
          );

          if (existingPlayer.rows.length > 0) {
            logger.info(`🛡️ ⚠️ Nickname already taken: ${nickname}`);
            return res.status(400).json({
              success: false,
              error: 'This nickname is already taken',
              errorType: 'taken',
              suggestion: 'Try adding numbers or modifying the name'
            });
          }
        } catch (dbError) {
          logger.error('Database error during nickname check:', dbError);
          // Continue validation even if DB check fails
        }

        // Step 4: All validations passed
        logger.info(`🛡️ ✅ Nickname approved: ${nickname}`);
        res.json({
          success: true,
          message: 'Nickname is valid and available',
          cleanedNickname: nickname,
          serverValidation: {
            profanityCheck: 'passed',
            reservedCheck: 'passed',
            availabilityCheck: 'passed'
          }
        });

      } catch (error) {
        logger.error('Error validating nickname:', error);
        res.status(500).json({
          success: false,
          error: 'Validation service temporarily unavailable',
          errorType: 'server_error'
        });
      }
    }
  );

  /**
   * Get player profile
   * GET /api/player/profile
   */
  router.get('/profile', authenticateToken, async (req, res) => {
    try {
      const playerId = req.user.playerId;

      const player = await db.query(
        `SELECT id, nickname, best_score, best_streak, total_games_played,
                current_coins, current_gems, current_hearts, is_premium,
                heart_booster_expiry, auto_refill_expiry, created_at, last_active_at
         FROM players WHERE id = $1`,
        [playerId]
      );

      if (player.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Player not found'
        });
      }

      const playerData = player.rows[0];

      res.json({
        success: true,
        player: {
          ...playerData,
          heartBoosterActive: playerData.heart_booster_expiry && 
                            new Date(playerData.heart_booster_expiry) > new Date(),
          autoRefillActive: playerData.auto_refill_expiry && 
                          new Date(playerData.auto_refill_expiry) > new Date()
        }
      });

    } catch (error) {
      logger.error('Error getting player profile:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get player profile'
      });
    }
  });

  /**
   * Update player profile
   * PUT /api/player/profile
   */
  router.put('/profile',
    authenticateToken,
    [
      body('nickname')
        .optional()
        .isString()
        .trim()
        .isLength({ min: 2, max: 20 })
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('Invalid nickname format'),
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array()
          });
        }

        const playerId = req.user.playerId;
        const { nickname } = req.body;

        // If nickname is being updated, validate it first
        if (nickname) {
          const profanityResult = checkAdvancedProfanity(nickname);
          if (!profanityResult.isClean) {
            return res.status(400).json({
              success: false,
              error: 'Nickname contains inappropriate content',
              errorType: 'profanity'
            });
          }
        }

        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;

        if (nickname !== undefined) {
          updateFields.push(`nickname = $${paramCount}`);
          updateValues.push(nickname);
          paramCount++;
        }

        if (updateFields.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No fields to update'
          });
        }

        updateValues.push(playerId);
        const query = `
          UPDATE players 
          SET ${updateFields.join(', ')}, last_active_at = NOW()
          WHERE id = $${paramCount}
          RETURNING nickname
        `;

        const result = await db.query(query, updateValues);

        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Player not found'
          });
        }

        logger.info(`🛡️ Player profile updated: ${playerId} -> nickname: ${nickname}`);

        res.json({
          success: true,
          message: 'Profile updated successfully',
          updatedFields: { nickname: result.rows[0].nickname }
        });

      } catch (error) {
        logger.error('Error updating player profile:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to update profile'
        });
      }
    }
  );

  /**
   * 🔄 Activate Auto-Refill Booster
   * POST /api/player/activate-auto-refill
   */
  router.post('/activate-auto-refill',
    authenticateToken,
    [
      body('durationHours')
        .isInt({ min: 1, max: 168 }) // 1 hour to 1 week max
        .withMessage('Duration must be between 1 and 168 hours'),
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({
            success: false,
            error: 'Invalid duration',
            details: errors.array()
          });
        }

        const playerId = req.user.playerId;
        const { durationHours } = req.body;

        // Calculate expiry time
        const now = new Date();
        const expiryTime = new Date(now.getTime() + (durationHours * 60 * 60 * 1000));

        // Check if player already has active auto-refill
        const existingPlayer = await db.query(
          'SELECT auto_refill_expiry FROM players WHERE id = $1',
          [playerId]
        );

        if (existingPlayer.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Player not found'
          });
        }

        const currentExpiry = existingPlayer.rows[0].auto_refill_expiry;
        let finalExpiryTime = expiryTime;

        // If already active, extend from current expiry
        if (currentExpiry && new Date(currentExpiry) > now) {
          finalExpiryTime = new Date(new Date(currentExpiry).getTime() + (durationHours * 60 * 60 * 1000));
          logger.info(`🔄 Extending auto-refill for player ${playerId}: ${durationHours}h (new expiry: ${finalExpiryTime})`);
        } else {
          logger.info(`🔄 Activating auto-refill for player ${playerId}: ${durationHours}h`);
        }

        // Update player with new auto-refill expiry
        await db.query(
          'UPDATE players SET auto_refill_expiry = $1, last_active_at = NOW() WHERE id = $2',
          [finalExpiryTime, playerId]
        );

        // Log analytics event
        await db.query(
          `INSERT INTO analytics_events (player_id, event_type, event_category, event_data, created_at)
           VALUES ($1, 'auto_refill_activated', 'player_action', $2, NOW())`,
          [playerId, JSON.stringify({ 
            durationHours, 
            expiryTime: finalExpiryTime,
            wasExtension: currentExpiry && new Date(currentExpiry) > now
          })]
        );

        res.json({
          success: true,
          message: 'Auto-refill booster activated',
          expiryTime: finalExpiryTime,
          durationHours
        });

      } catch (error) {
        logger.error('Error activating auto-refill:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to activate auto-refill booster'
        });
      }
    }
  );

  /**
   * 💰 Sync Player Data from Client (full game state sync)
   * PUT /api/player/sync-currency
   * 
   * Accepts two formats:
   * 1. Simple: { coins, gems, syncReason }
   * 2. Full: { stats: {...}, resources: {...}, pendingChanges: {...}, lastSyncTime }
   */
  router.put('/sync-currency',
    authenticateToken,
    async (req, res) => {
      try {
        const playerId = req.user.playerId;
        
        // 🔍 Detect data format (simple vs full)
        const isFullSync = req.body.stats && req.body.resources;
        
        let coins, gems, syncReason;
        let stats = null;
        let resources = null;
        
        if (isFullSync) {
          // 📊 Full game data sync
          logger.info('📊 Full game data sync received:', {
            playerId,
            hasStats: !!req.body.stats,
            hasResources: !!req.body.resources,
            hasPendingChanges: !!req.body.pendingChanges
          });
          
          stats = req.body.stats;
          resources = req.body.resources;
          
          // Extract coins and gems from resources
          coins = resources?.coins;
          gems = resources?.gems;
          syncReason = 'full_game_sync';
          
          // Validate extracted values
          if (typeof coins !== 'number' || typeof gems !== 'number') {
            logger.warn('💰 Invalid data in full sync:', {
              coins, gems, coinsType: typeof coins, gemsType: typeof gems
            });
            return res.status(400).json({
              success: false,
              error: 'Invalid currency values in resources'
            });
          }
        } else {
          // 💰 Simple currency sync
          logger.info('💰 Simple currency sync received:', {
            playerId,
            coins: req.body.coins,
            gems: req.body.gems,
            syncReason: req.body.syncReason
          });
          
          coins = req.body.coins;
          gems = req.body.gems;
          syncReason = req.body.syncReason;
          
          // Validate simple format
          if (typeof coins !== 'number' || typeof gems !== 'number') {
            logger.warn('💰 Invalid currency values:', {
              coins, gems, coinsType: typeof coins, gemsType: typeof gems
            });
            return res.status(400).json({
              success: false,
              error: 'Invalid currency values'
            });
          }
        }
        
        // 🔧 Ensure values are valid integers
        coins = parseInt(coins, 10);
        gems = parseInt(gems, 10);
        
        if (isNaN(coins) || isNaN(gems) || coins < 0 || gems < 0) {
          return res.status(400).json({
            success: false,
            error: 'Currency values must be non-negative integers'
          });
        }

        // Get current backend values for comparison
        const currentPlayer = await db.query(
          'SELECT current_coins, current_gems FROM players WHERE id = $1',
          [playerId]
        );

        if (currentPlayer.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Player not found'
          });
        }

        const currentData = currentPlayer.rows[0];
        
        // Smart conflict resolution based on sync reason
        let finalCoins, finalGems;
        
        if (syncReason === 'coin_spending' || syncReason === 'gem_spending') {
          // For spending scenarios, trust the client (lower values)
          finalCoins = coins;
          finalGems = gems;
        } else {
          // For other scenarios (conflict resolution), take the higher value
          finalCoins = Math.max(currentData.current_coins || 0, coins);
          finalGems = Math.max(currentData.current_gems || 0, gems);
        }

        // Update player currency
        await db.query(
          `UPDATE players 
           SET current_coins = $1, current_gems = $2, last_active_at = NOW()
           WHERE id = $3`,
          [finalCoins, finalGems, playerId]
        );
        
        // 📊 If full sync, save additional stats and resources
        if (isFullSync && stats && resources) {
          try {
            // Update best score and streak if higher
            if (stats.bestScore || stats.bestStreak) {
              await db.query(
                `UPDATE players 
                 SET best_score = GREATEST(COALESCE(best_score, 0), $1),
                     best_streak = GREATEST(COALESCE(best_streak, 0), $2)
                 WHERE id = $3`,
                [stats.bestScore || 0, stats.bestStreak || 0, playerId]
              );
            }
            
            // Log full game data for analytics
            await db.query(
              `INSERT INTO analytics_events (player_id, event_type, event_category, event_data, created_at)
               VALUES ($1, 'full_game_sync', 'player_action', $2, NOW())`,
              [playerId, JSON.stringify({
                stats: {
                  bestScore: stats.bestScore,
                  bestStreak: stats.bestStreak,
                  totalGamesPlayed: stats.totalGamesPlayed,
                  totalCoinsEarned: stats.totalCoinsEarned,
                  totalGemsEarned: stats.totalGemsEarned,
                  totalPlayTime: stats.totalPlayTime
                },
                resources: {
                  coins: resources.coins,
                  gems: resources.gems,
                  hearts: resources.hearts,
                  heartBoosterActive: resources.heartBoosterActive
                },
                syncReason: 'full_game_sync'
              })]
            );
            
            logger.info(`📊 Full game data saved for player ${playerId}:`, {
              bestScore: stats.bestScore,
              bestStreak: stats.bestStreak,
              totalGamesPlayed: stats.totalGamesPlayed,
              coins: finalCoins,
              gems: finalGems
            });
          } catch (statsError) {
            // Don't fail the whole sync if stats logging fails
            logger.error('📊 Error saving full game stats:', statsError);
          }
        } else {
          // Log simple currency sync event for analytics
          await db.query(
            `INSERT INTO analytics_events (player_id, event_type, event_category, event_data, created_at)
             VALUES ($1, 'currency_sync', 'player_action', $2, NOW())`,
            [playerId, JSON.stringify({
              syncReason: syncReason || 'manual',
              clientCoins: coins,
              clientGems: gems,
              backendCoins: currentData.current_coins,
              backendGems: currentData.current_gems,
              finalCoins,
              finalGems
            })]
          );
        }

        logger.info(`💰 Currency synced for player ${playerId}: ${currentData.current_coins}→${finalCoins} coins, ${currentData.current_gems}→${finalGems} gems (reason: ${syncReason})`);

        res.json({
          success: true,
          message: 'Currency synchronized',
          finalCoins,
          finalGems,
          wasUpdated: finalCoins !== currentData.current_coins || finalGems !== currentData.current_gems
        });

      } catch (error) {
        logger.error('Error syncing currency:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to sync currency'
        });
      }
    }
  );

  /**
   * 🔄 Check and Trigger Auto-Refill
   * POST /api/player/check-auto-refill
   */
  router.post('/check-auto-refill', authenticateToken, async (req, res) => {
    try {
      const playerId = req.user.playerId;

      // Get player's current state
      const player = await db.query(
        `SELECT current_hearts, auto_refill_expiry, heart_booster_expiry 
         FROM players WHERE id = $1`,
        [playerId]
      );

      if (player.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Player not found'
        });
      }

      const playerData = player.rows[0];
      const now = new Date();
      
      // Check if auto-refill is active
      const autoRefillActive = playerData.auto_refill_expiry && 
                              new Date(playerData.auto_refill_expiry) > now;

      if (!autoRefillActive) {
        return res.json({
          success: true,
          autoRefillTriggered: false,
          reason: 'Auto-refill not active'
        });
      }

      // Determine max hearts (3 normal, 6 with heart booster)
      const heartBoosterActive = playerData.heart_booster_expiry && 
                                new Date(playerData.heart_booster_expiry) > now;
      const maxHearts = heartBoosterActive ? 6 : 3;

      // Check if hearts need refilling
      if (playerData.current_hearts >= maxHearts) {
        return res.json({
          success: true,
          autoRefillTriggered: false,
          reason: 'Hearts already at maximum',
          currentHearts: playerData.current_hearts,
          maxHearts
        });
      }

      // Refill hearts to maximum
      await db.query(
        'UPDATE players SET current_hearts = $1, last_active_at = NOW() WHERE id = $2',
        [maxHearts, playerId]
      );

      // Log analytics event
      await db.query(
        `INSERT INTO analytics_events (player_id, event_type, event_data, created_at)
         VALUES ($1, 'auto_refill_triggered', $2, NOW())`,
        [playerId, JSON.stringify({ 
          heartsAdded: maxHearts - playerData.current_hearts,
          previousHearts: playerData.current_hearts,
          newHearts: maxHearts,
          heartBoosterActive
        })]
      );

      logger.info(`🔄 Auto-refill triggered for player ${playerId}: ${playerData.current_hearts} → ${maxHearts} hearts`);

      res.json({
        success: true,
        autoRefillTriggered: true,
        previousHearts: playerData.current_hearts,
        newHearts: maxHearts,
        heartsAdded: maxHearts - playerData.current_hearts
      });

    } catch (error) {
      logger.error('Error checking auto-refill:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check auto-refill'
      });
    }
  });

  /**
   * 🛡️ Advanced profanity checking with multiple techniques
   */
  function checkAdvancedProfanity(text) {
    const lowerText = text.toLowerCase();
    
    // Step 1: Direct word matching
    for (const word of PROFANITY_WORDS) {
      if (lowerText.includes(word)) {
        return {
          isClean: false,
          reason: 'direct_match',
          cleaned: text.replace(new RegExp(word, 'gi'), '*'.repeat(word.length))
        };
      }
    }

    // Step 2: Leet speak normalization
    const leetMap = {
      '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', 
      '7': 't', '@': 'a', '$': 's', '!': 'i'
    };

    let normalized = lowerText;
    Object.entries(leetMap).forEach(([leet, normal]) => {
      normalized = normalized.replace(new RegExp(leet, 'g'), normal);
    });

    // Check normalized version
    for (const word of PROFANITY_WORDS) {
      if (normalized.includes(word)) {
        return {
          isClean: false,
          reason: 'leet_speak',
          cleaned: text.replace(new RegExp(word, 'gi'), '*'.repeat(word.length))
        };
      }
    }

    // Step 3: Character insertion detection (e.g., "b@d w0rd" -> "badword")
    const compressed = normalized.replace(/[^a-z]/g, '');
    for (const word of PROFANITY_WORDS) {
      if (compressed.includes(word)) {
        return {
          isClean: false,
          reason: 'character_insertion',
          cleaned: '*'.repeat(text.length)
        };
      }
    }

    // Step 4: Reverse text check
    const reversed = lowerText.split('').reverse().join('');
    for (const word of PROFANITY_WORDS) {
      if (reversed.includes(word)) {
        return {
          isClean: false,
          reason: 'reversed',
          cleaned: '*'.repeat(text.length)
        };
      }
    }

    return {
      isClean: true,
      reason: 'clean',
      cleaned: text
    };
  }

  return router;
};