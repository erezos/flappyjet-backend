const logger = require('../utils/logger');
/**
 * 🛡️ Anti-Cheat Engine
 * Advanced cheat detection and prevention system
 */

class AntiCheatEngine {
  constructor(database) {
    this.db = database;
    
    // Configuration thresholds
    this.config = {
      maxScorePerSecond: 10,           // Maximum points per second
      maxImprovementFactor: 2.0,       // Maximum improvement multiplier
      minGameDuration: 1000,           // Minimum game duration (ms)
      maxGameDuration: 600000,         // Maximum game duration (10 minutes)
      suspiciousPatternThreshold: 3,   // Number of suspicious patterns to flag
      rapidSubmissionWindow: 60000,    // Time window for rapid submission check (ms)
      maxSubmissionsPerWindow: 10,     // Max submissions in time window
      deviceFingerprintRequired: true, // Require device fingerprinting
      minTimeBetweenScores: 5000,     // Minimum time between score submissions (ms)
    };

    // Cheat detection patterns
    this.patterns = {
      impossibleImprovement: 'IMPOSSIBLE_IMPROVEMENT',
      suspiciousRatio: 'SUSPICIOUS_RATIO',
      rapidSubmission: 'RAPID_SUBMISSION',
      duplicateScore: 'DUPLICATE_SCORE',
      deviceSpoofing: 'DEVICE_SPOOFING',
      timeManipulation: 'TIME_MANIPULATION',
      patternAnomaly: 'PATTERN_ANOMALY'
    };
  }

  /**
   * Validate a score submission against all anti-cheat measures
   */
  async validateScore(playerId, scoreData, recentScores = []) {
    const validationResults = [];
    
    try {
      // 1. Basic data validation
      const basicValidation = this._validateBasicData(scoreData);
      if (!basicValidation.isValid) {
        return basicValidation;
      }

      // 2. Score-to-time ratio validation
      const ratioValidation = this._validateScoreTimeRatio(scoreData);
      if (!ratioValidation.isValid) {
        validationResults.push(ratioValidation);
      }

      // 3. Improvement pattern analysis
      if (recentScores.length > 0) {
        const improvementValidation = this._validateImprovementPattern(scoreData.score, recentScores);
        if (!improvementValidation.isValid) {
          validationResults.push(improvementValidation);
        }
      }

      // 4. Rapid submission detection
      const rapidSubmissionValidation = await this._validateSubmissionRate(playerId);
      if (!rapidSubmissionValidation.isValid) {
        validationResults.push(rapidSubmissionValidation);
      }

      // 5. Duplicate score detection
      const duplicateValidation = await this._validateDuplicateScore(playerId, scoreData);
      if (!duplicateValidation.isValid) {
        validationResults.push(duplicateValidation);
      }

      // 6. Time manipulation detection
      const timeValidation = this._validateTimeConsistency(scoreData);
      if (!timeValidation.isValid) {
        validationResults.push(timeValidation);
      }

      // 7. Device fingerprint validation (if available)
      if (scoreData.deviceFingerprint) {
        const deviceValidation = await this._validateDeviceFingerprint(playerId, scoreData.deviceFingerprint);
        if (!deviceValidation.isValid) {
          validationResults.push(deviceValidation);
        }
      }

      // Determine overall result
      const suspiciousPatterns = validationResults.filter(r => !r.isValid);
      
      if (suspiciousPatterns.length === 0) {
        // Log successful validation
        await this._logValidationResult(playerId, scoreData, true, 'All checks passed');
        
        return {
          isValid: true,
          confidence: 1.0,
          patterns: [],
          message: 'Score validation passed'
        };
      }

      // Check if we should reject based on severity
      const criticalPatterns = suspiciousPatterns.filter(p => p.severity === 'critical');
      const shouldReject = criticalPatterns.length > 0 || 
                          suspiciousPatterns.length >= this.config.suspiciousPatternThreshold;

      const confidence = Math.max(0, 1 - (suspiciousPatterns.length * 0.3));
      const reasons = suspiciousPatterns.map(p => p.reason).join('; ');

      // Log validation result
      await this._logValidationResult(playerId, scoreData, !shouldReject, reasons);

      return {
        isValid: !shouldReject,
        confidence,
        patterns: suspiciousPatterns.map(p => p.pattern),
        reason: reasons,
        severity: criticalPatterns.length > 0 ? 'critical' : 'warning'
      };

    } catch (error) {
      logger.error('🛡️ ❌ Anti-cheat validation error:', error.message);
      
      // On error, log and allow (fail open for availability)
      await this._logValidationResult(playerId, scoreData, true, `Validation error: ${error.message}`);
      
      return {
        isValid: true,
        confidence: 0.5,
        patterns: ['VALIDATION_ERROR'],
        reason: 'Anti-cheat validation failed, allowing submission'
      };
    }
  }

  /**
   * Detect suspicious improvement patterns
   */
  detectSuspiciousImprovement(recentScores, newScore) {
    if (recentScores.length === 0) {
      return { isSuspicious: false };
    }

    const scores = recentScores.map(s => s.score || s);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const maxScore = Math.max(...scores);
    
    // Check for impossible jumps
    const improvement = newScore - avgScore;
    const maxReasonableImprovement = avgScore * (this.config.maxImprovementFactor - 1);
    
    if (improvement > maxReasonableImprovement && newScore > maxScore * 1.5) {
      return {
        isSuspicious: true,
        reason: `Impossible improvement: ${improvement} points (${((improvement / avgScore) * 100).toFixed(1)}% increase)`,
        pattern: this.patterns.impossibleImprovement,
        severity: 'critical'
      };
    }

    return { isSuspicious: false };
  }

  /**
   * Validate score-to-time ratio
   */
  validateScoreTimeRatio(score, survivalTime) {
    if (!survivalTime || survivalTime <= 0) {
      return { isValid: true }; // Can't validate without time data
    }

    const scorePerSecond = score / (survivalTime / 1000);
    
    if (scorePerSecond > this.config.maxScorePerSecond) {
      return {
        isValid: false,
        reason: `Suspicious score-to-time ratio: ${scorePerSecond.toFixed(2)} points/second (max: ${this.config.maxScorePerSecond})`,
        pattern: this.patterns.suspiciousRatio,
        severity: 'critical'
      };
    }

    return { isValid: true };
  }

  /**
   * Get player's cheat detection history
   */
  async getPlayerCheatHistory(playerId, days = 30) {
    try {
      const query = `
        SELECT 
          pattern,
          severity,
          reason,
          created_at,
          score_data
        FROM anti_cheat_logs
        WHERE player_id = $1 
          AND created_at >= NOW() - INTERVAL '${days} days'
        ORDER BY created_at DESC
      `;

      const result = await this.db.query(query, [playerId]);
      
      return {
        success: true,
        history: result.rows,
        totalViolations: result.rows.length,
        criticalViolations: result.rows.filter(r => r.severity === 'critical').length
      };
    } catch (error) {
      logger.error('🛡️ ❌ Failed to get cheat history:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get anti-cheat statistics
   */
  async getAntiCheatStats(days = 7) {
    try {
      const query = `
        SELECT 
          pattern,
          severity,
          COUNT(*) as count,
          COUNT(DISTINCT player_id) as unique_players
        FROM anti_cheat_logs
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY pattern, severity
        ORDER BY count DESC
      `;

      const result = await this.db.query(query);
      
      const totalQuery = `
        SELECT 
          COUNT(*) as total_validations,
          COUNT(CASE WHEN is_valid = false THEN 1 END) as total_rejections
        FROM anti_cheat_logs
        WHERE created_at >= NOW() - INTERVAL '${days} days'
      `;

      const totalResult = await this.db.query(totalQuery);
      const totals = totalResult.rows[0];

      return {
        success: true,
        period: `${days} days`,
        patterns: result.rows,
        summary: {
          totalValidations: parseInt(totals.total_validations),
          totalRejections: parseInt(totals.total_rejections),
          rejectionRate: totals.total_validations > 0 
            ? ((totals.total_rejections / totals.total_validations) * 100).toFixed(2) + '%'
            : '0%'
        }
      };
    } catch (error) {
      logger.error('🛡️ ❌ Failed to get anti-cheat stats:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Private validation methods

  _validateBasicData(scoreData) {
    const { score, survivalTime, gameDuration } = scoreData;

    // Score validation
    if (typeof score !== 'number' || score < 0) {
      return {
        isValid: false,
        reason: 'Invalid score: must be a non-negative number',
        pattern: 'INVALID_DATA',
        severity: 'critical'
      };
    }

    if (score > 100000) {
      return {
        isValid: false,
        reason: 'Score exceeds maximum allowed value',
        pattern: 'INVALID_DATA',
        severity: 'critical'
      };
    }

    // Game duration validation
    if (gameDuration && (gameDuration < this.config.minGameDuration || gameDuration > this.config.maxGameDuration)) {
      return {
        isValid: false,
        reason: `Invalid game duration: ${gameDuration}ms (allowed: ${this.config.minGameDuration}-${this.config.maxGameDuration}ms)`,
        pattern: this.patterns.timeManipulation,
        severity: 'warning'
      };
    }

    return { isValid: true };
  }

  _validateScoreTimeRatio(scoreData) {
    return this.validateScoreTimeRatio(scoreData.score, scoreData.survivalTime);
  }

  _validateImprovementPattern(newScore, recentScores) {
    return this.detectSuspiciousImprovement(recentScores, newScore);
  }

  async _validateSubmissionRate(playerId) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM scores
        WHERE player_id = $1 
          AND created_at >= NOW() - INTERVAL '${this.config.rapidSubmissionWindow / 1000} seconds'
      `;

      const result = await this.db.query(query, [playerId]);
      const recentSubmissions = parseInt(result.rows[0].count);

      if (recentSubmissions >= this.config.maxSubmissionsPerWindow) {
        return {
          isValid: false,
          reason: `Too many submissions: ${recentSubmissions} in last ${this.config.rapidSubmissionWindow / 1000}s`,
          pattern: this.patterns.rapidSubmission,
          severity: 'warning'
        };
      }

      return { isValid: true };
    } catch (error) {
      logger.error('🛡️ ❌ Submission rate validation error:', error.message);
      return { isValid: true }; // Fail open
    }
  }

  async _validateDuplicateScore(playerId, scoreData) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM scores
        WHERE player_id = $1 
          AND score = $2 
          AND survival_time = $3
          AND created_at >= NOW() - INTERVAL '1 hour'
      `;

      const result = await this.db.query(query, [
        playerId, 
        scoreData.score, 
        scoreData.survivalTime || 0
      ]);

      const duplicates = parseInt(result.rows[0].count);

      if (duplicates > 0) {
        return {
          isValid: false,
          reason: 'Duplicate score detected within 1 hour',
          pattern: this.patterns.duplicateScore,
          severity: 'warning'
        };
      }

      return { isValid: true };
    } catch (error) {
      logger.error('🛡️ ❌ Duplicate score validation error:', error.message);
      return { isValid: true }; // Fail open
    }
  }

  _validateTimeConsistency(scoreData) {
    const { survivalTime, gameDuration } = scoreData;

    if (survivalTime && gameDuration) {
      // Survival time should not exceed game duration significantly
      if (survivalTime > gameDuration * 1.1) { // Allow 10% tolerance
        return {
          isValid: false,
          reason: `Survival time (${survivalTime}ms) exceeds game duration (${gameDuration}ms)`,
          pattern: this.patterns.timeManipulation,
          severity: 'critical'
        };
      }
    }

    return { isValid: true };
  }

  async _validateDeviceFingerprint(playerId, fingerprint) {
    try {
      // Check if this player has used different device fingerprints recently
      const query = `
        SELECT DISTINCT device_fingerprint
        FROM anti_cheat_logs
        WHERE player_id = $1 
          AND device_fingerprint IS NOT NULL
          AND created_at >= NOW() - INTERVAL '7 days'
      `;

      const result = await this.db.query(query, [playerId]);
      const recentFingerprints = result.rows.map(r => r.device_fingerprint);

      if (recentFingerprints.length > 0 && !recentFingerprints.includes(fingerprint)) {
        return {
          isValid: false,
          reason: 'Device fingerprint mismatch detected',
          pattern: this.patterns.deviceSpoofing,
          severity: 'warning'
        };
      }

      return { isValid: true };
    } catch (error) {
      logger.error('🛡️ ❌ Device fingerprint validation error:', error.message);
      return { isValid: true }; // Fail open
    }
  }

  async _logValidationResult(playerId, scoreData, isValid, reason) {
    try {
      // Ensure anti_cheat_logs table exists
      await this._ensureAntiCheatTable();

      const query = `
        INSERT INTO anti_cheat_logs (
          player_id, score_data, is_valid, reason, 
          pattern, severity, device_fingerprint
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;

      const pattern = isValid ? 'VALID' : 'VIOLATION';
      const severity = isValid ? 'info' : 'warning';

      await this.db.query(query, [
        playerId,
        JSON.stringify(scoreData),
        isValid,
        reason || 'No issues detected',
        pattern,
        severity,
        scoreData.deviceFingerprint || null
      ]);
    } catch (error) {
      logger.error('🛡️ ❌ Failed to log validation result:', error.message);
      // Don't throw - logging failure shouldn't break validation
    }
  }

  async _ensureAntiCheatTable() {
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS anti_cheat_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          player_id UUID NOT NULL,
          score_data JSONB,
          is_valid BOOLEAN NOT NULL,
          reason TEXT,
          pattern VARCHAR(100),
          severity VARCHAR(20),
          device_fingerprint TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create indexes for performance
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_anti_cheat_player_id ON anti_cheat_logs(player_id);
        CREATE INDEX IF NOT EXISTS idx_anti_cheat_created_at ON anti_cheat_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_anti_cheat_pattern ON anti_cheat_logs(pattern);
      `);
    } catch (error) {
      logger.error('🛡️ ❌ Failed to ensure anti-cheat table:', error.message);
    }
  }
}

module.exports = { AntiCheatEngine };
