/**
 * 🛡️ AdMob Server-Side Verification (SSV) Endpoints for Railway Backend
 * 
 * Add these endpoints to your Railway backend to prevent rewarded ad fraud.
 * These endpoints work with Google AdMob's SSV system to validate ad completions.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Add these routes to your Railway backend
 * 2. Install required dependencies: npm install crypto jsonwebtoken
 * 3. Configure AdMob SSV in Google AdMob console with your Railway URL
 * 4. Set environment variables for SSV public keys
 * 5. Create database tables for ad validation tracking
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();

// === CONFIGURATION ===

// AdMob SSV Public Keys (get these from Google AdMob console)
const ADMOB_SSV_PUBLIC_KEYS = {
  // These are example keys - replace with actual keys from AdMob console
  'key_id_1': `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----`,
  // Add more keys as needed
};

// Fraud prevention configuration
const FRAUD_PREVENTION = {
  MIN_VIEW_TIME_SECONDS: 15,
  MAX_VALIDATION_AGE_MINUTES: 5,
};

// === DATABASE SCHEMA ===
/*
CREATE TABLE ad_validations (
  id SERIAL PRIMARY KEY,
  validation_id VARCHAR(255) UNIQUE NOT NULL,
  player_id VARCHAR(255) NOT NULL,
  ad_unit_id VARCHAR(255) NOT NULL,
  reward_type VARCHAR(100) NOT NULL,
  reward_amount INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  ssv_verified BOOLEAN DEFAULT FALSE,
  view_duration_seconds INTEGER,
  fraud_score INTEGER DEFAULT 0,
  ip_address INET,
  user_agent TEXT,
  device_info JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  validated_at TIMESTAMP,
  granted_at TIMESTAMP,
  metadata JSONB
);

CREATE TABLE ad_fraud_tracking (
  id SERIAL PRIMARY KEY,
  player_id VARCHAR(255) NOT NULL,
  fraud_type VARCHAR(100) NOT NULL,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ad_validations_player_date ON ad_validations(player_id, DATE(created_at));
CREATE INDEX idx_ad_validations_validation_id ON ad_validations(validation_id);
CREATE INDEX idx_ad_fraud_tracking_player ON ad_fraud_tracking(player_id, created_at);
*/

// === MIDDLEWARE ===

// Basic spam prevention (very minimal)
function basicSpamPrevention(req, res, next) {
  // Just continue - no rate limiting
  next();
}

// === SSV VALIDATION ENDPOINTS ===

/**
 * AdMob Server-Side Verification Callback
 * This endpoint is called directly by Google AdMob when a user completes a rewarded ad
 * URL format: https://your-railway-app.railway.app/api/ads/ssv-callback
 */
router.post('/ssv-callback', async (req, res) => {
  try {
    console.log('🛡️ SSV: Received AdMob callback:', req.query);
    
    // Extract SSV parameters from query string (AdMob sends them as query params)
    const {
      ad_network,
      ad_unit,
      reward_amount,
      reward_item,
      timestamp,
      transaction_id,
      user_id,
      signature,
      key_id,
      custom_data
    } = req.query;

    // Validate required parameters
    if (!signature || !key_id || !transaction_id) {
      console.error('🛡️ SSV: Missing required parameters');
      return res.status(400).json({ error: 'Missing required SSV parameters' });
    }

    // Verify SSV signature
    const isValidSignature = await verifySSVSignature(req.query, signature, key_id);
    if (!isValidSignature) {
      console.error('🛡️ SSV: Invalid signature');
      await logFraudAttempt(user_id, 'invalid_ssv_signature', req.query, req.ip);
      return res.status(401).json({ error: 'Invalid SSV signature' });
    }

    // Parse custom data (contains validation_id from client)
    let validationId = null;
    if (custom_data) {
      try {
        const customDataObj = JSON.parse(Buffer.from(custom_data, 'base64').toString());
        validationId = customDataObj.validation_id;
      } catch (e) {
        console.warn('🛡️ SSV: Could not parse custom_data:', e);
      }
    }

    // Update validation record
    const result = await updateValidationFromSSV({
      validationId,
      playerId: user_id,
      adUnitId: ad_unit,
      rewardType: reward_item,
      rewardAmount: parseInt(reward_amount) || 1,
      transactionId: transaction_id,
      timestamp: new Date(parseInt(timestamp) * 1000),
      ssvVerified: true,
      metadata: {
        ad_network,
        ssv_timestamp: timestamp,
        transaction_id,
      }
    });

    console.log('🛡️ SSV: Validation updated:', result);
    res.status(200).json({ success: true, message: 'SSV processed' });

  } catch (error) {
    console.error('🛡️ SSV: Callback error:', error);
    res.status(500).json({ error: 'SSV processing failed' });
  }
});

/**
 * Validate Rewarded Ad (called by Flutter client)
 * This initiates the validation process and returns immediately
 */
router.post('/validate-reward', authenticateToken, basicSpamPrevention, async (req, res) => {
  try {
    const {
      validationId,
      adUnitId,
      rewardType,
      rewardAmount,
      customData,
      minViewTime,
      deviceInfo
    } = req.body;

    const playerId = req.user.playerId;

    // Fraud prevention checks
    const fraudCheck = await performFraudChecks(playerId, req.ip);
    if (!fraudCheck.passed) {
      await logFraudAttempt(playerId, fraudCheck.reason, req.body, req.ip);
      return res.status(403).json({
        success: false,
        valid: false,
        message: `Fraud detected: ${fraudCheck.reason}`,
        metadata: { fraudScore: fraudCheck.score }
      });
    }

    // Create validation record
    const validation = await createValidationRecord({
      validationId,
      playerId,
      adUnitId,
      rewardType,
      rewardAmount: parseInt(rewardAmount) || 1,
      minViewTime: parseInt(minViewTime) || FRAUD_PREVENTION.MIN_VIEW_TIME_SECONDS,
      deviceInfo,
      customData,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    console.log('🛡️ SSV: Validation record created:', validationId);

    res.json({
      success: true,
      validationId,
      message: 'Validation initiated - waiting for SSV callback',
      status: 'pending'
    });

  } catch (error) {
    console.error('🛡️ SSV: Validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Validation service error'
    });
  }
});

/**
 * Check Validation Status (polled by Flutter client)
 */
router.get('/validation-status', authenticateToken, async (req, res) => {
  try {
    const { validationId } = req.query;
    const playerId = req.user.playerId;

    if (!validationId) {
      return res.status(400).json({ error: 'Validation ID required' });
    }

    const validation = await getValidationStatus(validationId, playerId);
    
    if (!validation) {
      return res.status(404).json({
        status: 'not_found',
        message: 'Validation not found'
      });
    }

    // Check if validation expired
    const ageMinutes = (Date.now() - validation.created_at.getTime()) / (1000 * 60);
    if (ageMinutes > FRAUD_PREVENTION.MAX_VALIDATION_AGE_MINUTES && validation.status === 'pending') {
      await updateValidationStatus(validationId, 'expired');
      validation.status = 'expired';
    }

    res.json({
      status: validation.status,
      valid: validation.status === 'completed' && validation.ssv_verified,
      rewardType: validation.reward_type,
      rewardAmount: validation.reward_amount,
      message: getStatusMessage(validation.status),
      metadata: validation.metadata
    });

  } catch (error) {
    console.error('🛡️ SSV: Status check error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

/**
 * Get Fraud Prevention Stats (for admin/debugging)
 */
router.get('/fraud-stats', authenticateToken, async (req, res) => {
  try {
    const playerId = req.user.playerId;
    const stats = await getFraudStats(playerId);
    res.json(stats);
  } catch (error) {
    console.error('🛡️ SSV: Stats error:', error);
    res.status(500).json({ error: 'Stats unavailable' });
  }
});

// === HELPER FUNCTIONS ===

/**
 * Verify AdMob SSV signature
 */
async function verifySSVSignature(queryParams, signature, keyId) {
  try {
    const publicKey = ADMOB_SSV_PUBLIC_KEYS[keyId];
    if (!publicKey) {
      console.error('🛡️ SSV: Unknown key ID:', keyId);
      return false;
    }

    // Reconstruct the message that was signed
    const message = Object.keys(queryParams)
      .filter(key => key !== 'signature' && key !== 'key_id')
      .sort()
      .map(key => `${key}=${queryParams[key]}`)
      .join('&');

    // Verify signature
    const verifier = crypto.createVerify('SHA256');
    verifier.update(message);
    
    const isValid = verifier.verify(publicKey, signature, 'base64');
    console.log('🛡️ SSV: Signature verification:', isValid ? 'VALID' : 'INVALID');
    
    return isValid;
  } catch (error) {
    console.error('🛡️ SSV: Signature verification error:', error);
    return false;
  }
}

/**
 * Perform minimal fraud prevention checks
 */
async function performFraudChecks(playerId, ipAddress) {
  try {
    // Only check for obvious spam/abuse patterns
    const recentCount = await db.query(`
      SELECT COUNT(*) as count 
      FROM ad_validations 
      WHERE player_id = $1 AND created_at > NOW() - INTERVAL '1 minute'
    `, [playerId]);

    // Only block if more than 10 requests in 1 minute (obvious spam)
    if (recentCount.rows[0].count >= 10) {
      return {
        passed: false,
        reason: 'spam_detected',
        score: 90
      };
    }

    return { passed: true, score: 0 };
  } catch (error) {
    console.error('🛡️ SSV: Fraud check error:', error);
    return { passed: true, score: 0 }; // Fail open for availability
  }
}

/**
 * Create validation record in database
 */
async function createValidationRecord(data) {
  const query = `
    INSERT INTO ad_validations (
      validation_id, player_id, ad_unit_id, reward_type, reward_amount,
      view_duration_seconds, ip_address, user_agent, device_info, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  
  const values = [
    data.validationId,
    data.playerId,
    data.adUnitId,
    data.rewardType,
    data.rewardAmount,
    data.minViewTime,
    data.ipAddress,
    data.userAgent,
    JSON.stringify(data.deviceInfo),
    JSON.stringify({ customData: data.customData })
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Update validation from SSV callback
 */
async function updateValidationFromSSV(data) {
  const query = `
    UPDATE ad_validations 
    SET 
      status = 'completed',
      ssv_verified = $1,
      validated_at = NOW(),
      metadata = COALESCE(metadata, '{}') || $2
    WHERE validation_id = $3 OR (player_id = $4 AND ad_unit_id = $5 AND status = 'pending')
    RETURNING *
  `;

  const values = [
    data.ssvVerified,
    JSON.stringify(data.metadata),
    data.validationId,
    data.playerId,
    data.adUnitId
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Get validation status
 */
async function getValidationStatus(validationId, playerId) {
  const query = `
    SELECT * FROM ad_validations 
    WHERE validation_id = $1 AND player_id = $2
  `;
  
  const result = await db.query(query, [validationId, playerId]);
  return result.rows[0];
}

/**
 * Update validation status
 */
async function updateValidationStatus(validationId, status) {
  const query = `
    UPDATE ad_validations 
    SET status = $1, validated_at = NOW()
    WHERE validation_id = $2
  `;
  
  await db.query(query, [status, validationId]);
}

/**
 * Log fraud attempt
 */
async function logFraudAttempt(playerId, fraudType, details, ipAddress) {
  const query = `
    INSERT INTO ad_fraud_tracking (player_id, fraud_type, details, ip_address)
    VALUES ($1, $2, $3, $4)
  `;
  
  await db.query(query, [
    playerId,
    fraudType,
    JSON.stringify(details),
    ipAddress
  ]);
}

/**
 * Get fraud prevention stats
 */
async function getFraudStats(playerId) {
  const [fraudAttempts, recentValidations] = await Promise.all([
    db.query(`
      SELECT COUNT(*) as count 
      FROM ad_fraud_tracking 
      WHERE player_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
    `, [playerId]),
    
    db.query(`
      SELECT status, COUNT(*) as count 
      FROM ad_validations 
      WHERE player_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
      GROUP BY status
    `, [playerId])
  ]);

  return {
    serverValidationEnabled: true,
    fraudAttempts24h: fraudAttempts.rows[0].count,
    recentValidations: recentValidations.rows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {}),
    fraudScore: Math.min(fraudAttempts.rows[0].count * 10, 100)
  };
}

/**
 * Get status message
 */
function getStatusMessage(status) {
  const messages = {
    'pending': 'Waiting for ad completion verification',
    'completed': 'Ad verified and reward granted',
    'expired': 'Validation expired - ad may not have been completed',
    'fraud': 'Fraudulent activity detected',
    'failed': 'Validation failed'
  };
  
  return messages[status] || 'Unknown status';
}

// Note: You'll need to implement authenticateToken middleware and db connection
// based on your existing Railway backend setup

/**
 * Anonymous SSV Validation Endpoint
 * POST /api/ads/validate-reward-anonymous
 */
router.post('/validate-reward-anonymous', 
  rateLimitMiddleware('anonymous_ssv', 60, 10), // Lower limit for anonymous users
  [
    body('validationId').isString().isLength({ min: 1, max: 255 }).withMessage('Validation ID required'),
    body('deviceId').isString().isLength({ min: 10, max: 255 }).withMessage('Device ID required'),
    body('adUnitId').isString().withMessage('Ad unit ID required'),
    body('rewardType').isString().withMessage('Reward type required'),
    body('rewardAmount').isInt({ min: 1 }).withMessage('Reward amount must be positive'),
    body('isAnonymous').isBoolean().withMessage('Anonymous flag required'),
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

      const {
        validationId,
        deviceId,
        adUnitId,
        rewardType,
        rewardAmount,
        customData,
        minViewTime,
        deviceInfo
      } = req.body;

      // Create anonymous player ID
      const anonymousPlayerId = `anon_${deviceId}`;

      console.log(`🛡️ Anonymous SSV validation: ${validationId} for ${anonymousPlayerId}`);

      // Basic fraud prevention for anonymous users
      const recentCount = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ad_validations 
        WHERE player_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
      `, [anonymousPlayerId]);

      if (recentCount.rows[0].count >= 5) {
        await logFraudAttempt(anonymousPlayerId, 'too_many_requests', req.body, req.ip);
        return res.status(429).json({
          success: false,
          valid: false,
          message: 'Too many validation requests. Please wait.',
          metadata: { reason: 'rate_limited' }
        });
      }

      // Create validation record for anonymous user
      const validation = await createValidationRecord({
        validationId,
        playerId: anonymousPlayerId,
        adUnitId,
        rewardType,
        rewardAmount,
        customData,
        minViewTime,
        deviceInfo,
        isAnonymous: true
      });

      if (validation.success) {
        res.json({
          success: true,
          valid: true,
          message: 'Anonymous SSV validation initiated',
          validationId: validationId,
          playerId: anonymousPlayerId
        });
      } else {
        res.status(500).json({
          success: false,
          valid: false,
          message: 'Failed to create validation record',
          error: validation.error
        });
      }

    } catch (error) {
      console.error('🛡️ ❌ Anonymous SSV validation error:', error);
      res.status(500).json({
        success: false,
        valid: false,
        message: 'Internal server error during anonymous SSV validation'
      });
    }
  }
);

module.exports = router;

/**
 * SETUP CHECKLIST:
 * 
 * 1. ✅ Add these routes to your Railway backend
 * 2. ✅ Create database tables (see schema above)
 * 3. ✅ Install dependencies: npm install crypto jsonwebtoken
 * 4. ✅ Configure AdMob SSV in Google AdMob console:
 *    - Set SSV URL: https://your-railway-app.railway.app/api/ads/ssv-callback
 *    - Get public keys and add to ADMOB_SSV_PUBLIC_KEYS
 * 5. ✅ Set up environment variables for production
 * 6. ✅ Test with AdMob test ads first
 * 7. ✅ Monitor fraud prevention logs
 * 8. ✅ Set up alerts for high fraud scores
 */
