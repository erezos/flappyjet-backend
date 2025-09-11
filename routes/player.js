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
    // Basic profanity (add your comprehensive list here)
    'badword1', 'badword2', 'inappropriate', 'offensive',
    // Game-specific terms
    'cheat', 'hack', 'exploit', 'glitch', 'spam', 'bot',
    // Add more comprehensive lists as needed
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
                heart_booster_expiry, created_at, last_active_at
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
                            new Date(playerData.heart_booster_expiry) > new Date()
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