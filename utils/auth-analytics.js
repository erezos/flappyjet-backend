/// 🔐 Authentication Analytics Logger
/// Tracks authentication patterns, security events, and user behavior

const logger = require('./logger');

class AuthAnalytics {
  constructor() {
    this.sessionStats = new Map(); // Track session statistics
    this.suspiciousActivity = new Map(); // Track suspicious patterns
    this.dailyStats = {
      registrations: 0,
      logins: 0,
      failures: 0,
      date: new Date().toDateString()
    };
  }

  /// Track registration event
  trackRegistration(data) {
    const { playerId, clientIP, platform, isNewPlayer, deviceId } = data;
    
    // Update daily stats
    this.updateDailyStats('registrations');
    
    // Log registration event
    logger.info('📊 AUTH ANALYTICS - REGISTRATION', {
      event: 'registration',
      playerId,
      clientIP,
      platform,
      isNewPlayer,
      deviceId: deviceId?.substring(0, 8) + '***',
      timestamp: new Date().toISOString(),
      dailyRegistrations: this.dailyStats.registrations
    });

    // Check for suspicious registration patterns
    this.checkSuspiciousRegistration(clientIP, deviceId);
  }

  /// Track login event
  trackLogin(data) {
    const { playerId, clientIP, platform, success, reason, deviceId } = data;
    
    // Update daily stats
    if (success) {
      this.updateDailyStats('logins');
    } else {
      this.updateDailyStats('failures');
    }
    
    // Log login event
    logger.info('📊 AUTH ANALYTICS - LOGIN', {
      event: 'login',
      playerId,
      clientIP,
      platform,
      success,
      reason,
      deviceId: deviceId?.substring(0, 8) + '***',
      timestamp: new Date().toISOString(),
      dailyLogins: this.dailyStats.logins,
      dailyFailures: this.dailyStats.failures
    });

    // Track session data
    if (success) {
      this.trackSession(playerId, clientIP, platform);
    } else {
      this.checkSuspiciousLogin(clientIP, reason);
    }
  }

  /// Track authentication failure
  trackAuthFailure(data) {
    const { clientIP, endpoint, reason, userAgent } = data;
    
    this.updateDailyStats('failures');
    
    logger.warn('📊 AUTH ANALYTICS - FAILURE', {
      event: 'auth_failure',
      clientIP,
      endpoint,
      reason,
      userAgent,
      timestamp: new Date().toISOString(),
      dailyFailures: this.dailyStats.failures
    });

    this.checkSuspiciousActivity(clientIP, 'auth_failure');
  }

  /// Track session data
  trackSession(playerId, clientIP, platform) {
    const sessionKey = `${playerId}_${clientIP}`;
    const now = Date.now();
    
    if (!this.sessionStats.has(sessionKey)) {
      this.sessionStats.set(sessionKey, {
        playerId,
        clientIP,
        platform,
        firstSeen: now,
        lastSeen: now,
        sessionCount: 1,
        platforms: new Set([platform])
      });
    } else {
      const session = this.sessionStats.get(sessionKey);
      session.lastSeen = now;
      session.sessionCount++;
      session.platforms.add(platform);
    }
  }

  /// Check for suspicious registration patterns
  checkSuspiciousRegistration(clientIP, deviceId) {
    const key = `reg_${clientIP}`;
    const now = Date.now();
    const timeWindow = 60 * 60 * 1000; // 1 hour
    
    if (!this.suspiciousActivity.has(key)) {
      this.suspiciousActivity.set(key, {
        type: 'registration',
        count: 1,
        firstSeen: now,
        lastSeen: now,
        deviceIds: new Set([deviceId])
      });
    } else {
      const activity = this.suspiciousActivity.get(key);
      activity.count++;
      activity.lastSeen = now;
      activity.deviceIds.add(deviceId);
      
      // Alert if too many registrations from same IP
      if (activity.count > 5 && (now - activity.firstSeen) < timeWindow) {
        logger.warn('🚨 SUSPICIOUS ACTIVITY - MULTIPLE REGISTRATIONS', {
          clientIP,
          registrationCount: activity.count,
          timeWindow: Math.floor((now - activity.firstSeen) / 1000 / 60) + ' minutes',
          uniqueDevices: activity.deviceIds.size,
          severity: 'HIGH'
        });
      }
    }
  }

  /// Check for suspicious login patterns
  checkSuspiciousLogin(clientIP, reason) {
    const key = `login_${clientIP}`;
    const now = Date.now();
    const timeWindow = 30 * 60 * 1000; // 30 minutes
    
    if (!this.suspiciousActivity.has(key)) {
      this.suspiciousActivity.set(key, {
        type: 'login_failure',
        count: 1,
        firstSeen: now,
        lastSeen: now,
        reasons: new Set([reason])
      });
    } else {
      const activity = this.suspiciousActivity.get(key);
      activity.count++;
      activity.lastSeen = now;
      activity.reasons.add(reason);
      
      // Alert if too many failed logins from same IP
      if (activity.count > 10 && (now - activity.firstSeen) < timeWindow) {
        logger.warn('🚨 SUSPICIOUS ACTIVITY - MULTIPLE LOGIN FAILURES', {
          clientIP,
          failureCount: activity.count,
          timeWindow: Math.floor((now - activity.firstSeen) / 1000 / 60) + ' minutes',
          reasons: Array.from(activity.reasons),
          severity: 'HIGH'
        });
      }
    }
  }

  /// Check for general suspicious activity
  checkSuspiciousActivity(clientIP, activityType) {
    const key = `activity_${clientIP}`;
    const now = Date.now();
    
    if (!this.suspiciousActivity.has(key)) {
      this.suspiciousActivity.set(key, {
        type: 'general',
        activities: new Map([[activityType, 1]]),
        firstSeen: now,
        lastSeen: now
      });
    } else {
      const activity = this.suspiciousActivity.get(key);
      const currentCount = activity.activities.get(activityType) || 0;
      activity.activities.set(activityType, currentCount + 1);
      activity.lastSeen = now;
    }
  }

  /// Update daily statistics
  updateDailyStats(type) {
    const today = new Date().toDateString();
    
    // Reset stats if it's a new day
    if (this.dailyStats.date !== today) {
      this.dailyStats = {
        registrations: 0,
        logins: 0,
        failures: 0,
        date: today
      };
      
      logger.info('📊 AUTH ANALYTICS - NEW DAY', {
        date: today,
        message: 'Daily authentication statistics reset'
      });
    }
    
    this.dailyStats[type]++;
  }

  /// Get daily statistics
  getDailyStats() {
    return { ...this.dailyStats };
  }

  /// Get session statistics
  getSessionStats() {
    const stats = {
      totalSessions: this.sessionStats.size,
      activeSessions: 0,
      platformDistribution: {},
      averageSessionsPerUser: 0
    };
    
    const now = Date.now();
    const activeThreshold = 24 * 60 * 60 * 1000; // 24 hours
    let totalSessionCount = 0;
    
    for (const [key, session] of this.sessionStats) {
      if ((now - session.lastSeen) < activeThreshold) {
        stats.activeSessions++;
      }
      
      totalSessionCount += session.sessionCount;
      
      for (const platform of session.platforms) {
        stats.platformDistribution[platform] = (stats.platformDistribution[platform] || 0) + 1;
      }
    }
    
    stats.averageSessionsPerUser = stats.totalSessions > 0 ? 
      Math.round(totalSessionCount / stats.totalSessions * 100) / 100 : 0;
    
    return stats;
  }

  /// Get suspicious activity report
  getSuspiciousActivityReport() {
    const report = {
      totalSuspiciousIPs: this.suspiciousActivity.size,
      highRiskActivities: [],
      activityTypes: {}
    };
    
    const now = Date.now();
    const recentThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [key, activity] of this.suspiciousActivity) {
      if ((now - activity.lastSeen) < recentThreshold) {
        const ip = key.split('_')[1];
        
        if (activity.count > 5) {
          report.highRiskActivities.push({
            ip,
            type: activity.type,
            count: activity.count,
            lastSeen: new Date(activity.lastSeen).toISOString()
          });
        }
        
        report.activityTypes[activity.type] = (report.activityTypes[activity.type] || 0) + 1;
      }
    }
    
    return report;
  }

  /// Clean up old data (call periodically)
  cleanup() {
    const now = Date.now();
    const cleanupThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    // Clean up old session data
    for (const [key, session] of this.sessionStats) {
      if ((now - session.lastSeen) > cleanupThreshold) {
        this.sessionStats.delete(key);
      }
    }
    
    // Clean up old suspicious activity data
    for (const [key, activity] of this.suspiciousActivity) {
      if ((now - activity.lastSeen) > cleanupThreshold) {
        this.suspiciousActivity.delete(key);
      }
    }
    
    logger.info('📊 AUTH ANALYTICS - CLEANUP', {
      remainingSessions: this.sessionStats.size,
      remainingSuspiciousActivities: this.suspiciousActivity.size,
      message: 'Cleaned up old authentication analytics data'
    });
  }

  /// Generate comprehensive report
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      dailyStats: this.getDailyStats(),
      sessionStats: this.getSessionStats(),
      suspiciousActivity: this.getSuspiciousActivityReport(),
      summary: {
        totalAuthEvents: this.dailyStats.registrations + this.dailyStats.logins + this.dailyStats.failures,
        successRate: this.dailyStats.logins > 0 ? 
          Math.round((this.dailyStats.logins / (this.dailyStats.logins + this.dailyStats.failures)) * 100) : 0,
        newUserRate: this.dailyStats.registrations > 0 && this.dailyStats.logins > 0 ?
          Math.round((this.dailyStats.registrations / (this.dailyStats.registrations + this.dailyStats.logins)) * 100) : 0
      }
    };
    
    logger.info('📊 AUTH ANALYTICS - REPORT GENERATED', report);
    
    return report;
  }
}

// Create singleton instance
const authAnalytics = new AuthAnalytics();

// Set up periodic cleanup (every 6 hours)
setInterval(() => {
  authAnalytics.cleanup();
}, 6 * 60 * 60 * 1000);

module.exports = authAnalytics;
