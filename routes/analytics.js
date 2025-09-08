/// 📊 Analytics Routes - Event tracking and metrics
const express = require('express');
const Joi = require('joi');

module.exports = (db) => {
  const router = express.Router();
  
  // Import auth middleware
  const authRoutes = require('./auth')(db);
const logger = require('../utils/logger');
  const authenticateToken = authRoutes.authenticateToken;

  // Validation schemas
  const trackEventSchema = Joi.object({
    eventName: Joi.string().required().max(100),
    eventCategory: Joi.string().required().max(50),
    parameters: Joi.object().optional(),
    sessionId: Joi.string().max(100).optional()
  });

  /// 📊 Track analytics event
  router.post('/event', authenticateToken, async (req, res) => {
    try {
      const { error, value } = trackEventSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { eventName, eventCategory, parameters, sessionId } = value;

      // Insert analytics event
      await db.query(`
        INSERT INTO analytics_events (
          player_id, event_name, event_category, parameters, session_id
        ) VALUES ($1, $2, $3, $4, $5)
      `, [req.playerId, eventName, eventCategory, JSON.stringify(parameters || {}), sessionId]);

      res.json({
        success: true,
        message: 'Event tracked successfully'
      });

    } catch (error) {
      logger.error('Analytics event error:', error);
      res.status(500).json({ error: 'Failed to track event' });
    }
  });

  /// 📈 Get player analytics
  router.get('/player', authenticateToken, async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 7, 30);
      
      // Get event summary for player
      const eventSummary = await db.query(`
        SELECT 
          event_category,
          event_name,
          COUNT(*) as event_count,
          DATE(created_at) as event_date
        FROM analytics_events
        WHERE player_id = $1 
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY event_category, event_name, DATE(created_at)
        ORDER BY event_date DESC, event_count DESC
      `, [req.playerId]);

      // Get session data
      const sessionData = await db.query(`
        SELECT 
          session_id,
          COUNT(*) as events_in_session,
          MIN(created_at) as session_start,
          MAX(created_at) as session_end
        FROM analytics_events
        WHERE player_id = $1 
          AND session_id IS NOT NULL
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY session_id
        ORDER BY session_start DESC
        LIMIT 20
      `, [req.playerId]);

      res.json({
        success: true,
        analytics: {
          eventSummary: eventSummary.rows,
          sessions: sessionData.rows,
          period: `${days} days`
        }
      });

    } catch (error) {
      logger.error('Player analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch player analytics' });
    }
  });

  /// 📊 Get global analytics (admin)
  router.get('/global', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 7, 30);

      // Daily active users
      const dauStats = await db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(DISTINCT player_id) as daily_active_users
        FROM analytics_events
        WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      // Top events
      const topEvents = await db.query(`
        SELECT 
          event_name,
          event_category,
          COUNT(*) as event_count,
          COUNT(DISTINCT player_id) as unique_players
        FROM analytics_events
        WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY event_name, event_category
        ORDER BY event_count DESC
        LIMIT 20
      `);

      // Retention metrics
      const retentionStats = await db.query(`
        WITH first_seen AS (
          SELECT 
            player_id,
            MIN(DATE(created_at)) as first_date
          FROM analytics_events
          GROUP BY player_id
        ),
        retention_cohorts AS (
          SELECT 
            fs.first_date,
            COUNT(DISTINCT fs.player_id) as cohort_size,
            COUNT(DISTINCT CASE WHEN ae.created_at >= fs.first_date + INTERVAL '1 day' 
                                   AND ae.created_at < fs.first_date + INTERVAL '2 days' 
                              THEN ae.player_id END) as day1_retained,
            COUNT(DISTINCT CASE WHEN ae.created_at >= fs.first_date + INTERVAL '7 days' 
                                   AND ae.created_at < fs.first_date + INTERVAL '8 days' 
                              THEN ae.player_id END) as day7_retained
          FROM first_seen fs
          LEFT JOIN analytics_events ae ON fs.player_id = ae.player_id
          WHERE fs.first_date >= CURRENT_DATE - INTERVAL '${days} days'
          GROUP BY fs.first_date
        )
        SELECT 
          first_date,
          cohort_size,
          CASE WHEN cohort_size > 0 THEN (day1_retained::float / cohort_size * 100) ELSE 0 END as day1_retention_rate,
          CASE WHEN cohort_size > 0 THEN (day7_retained::float / cohort_size * 100) ELSE 0 END as day7_retention_rate
        FROM retention_cohorts
        ORDER BY first_date DESC
      `);

      res.json({
        success: true,
        analytics: {
          dailyActiveUsers: dauStats.rows,
          topEvents: topEvents.rows,
          retentionStats: retentionStats.rows,
          period: `${days} days`
        }
      });

    } catch (error) {
      logger.error('Global analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch global analytics' });
    }
  });

  /// 🎮 Get gameplay analytics
  router.get('/gameplay', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 7, 30);

      // Score distribution
      const scoreDistribution = await db.query(`
        SELECT 
          CASE 
            WHEN score < 10 THEN '0-9'
            WHEN score < 25 THEN '10-24'
            WHEN score < 50 THEN '25-49'
            WHEN score < 100 THEN '50-99'
            ELSE '100+'
          END as score_range,
          COUNT(*) as game_count,
          COUNT(DISTINCT player_id) as unique_players
        FROM scores
        WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY score_range
        ORDER BY 
          CASE score_range
            WHEN '0-9' THEN 1
            WHEN '10-24' THEN 2
            WHEN '25-49' THEN 3
            WHEN '50-99' THEN 4
            WHEN '100+' THEN 5
          END
      `);

      // Average session metrics
      const sessionMetrics = await db.query(`
        SELECT 
          AVG(score) as avg_score,
          AVG(survival_time) as avg_survival_time,
          AVG(game_duration) as avg_game_duration,
          COUNT(*) as total_games,
          COUNT(DISTINCT player_id) as unique_players
        FROM scores
        WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
      `);

      // Popular skins
      const skinUsage = await db.query(`
        SELECT 
          skin_used,
          COUNT(*) as usage_count,
          AVG(score) as avg_score_with_skin
        FROM scores
        WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY skin_used
        ORDER BY usage_count DESC
        LIMIT 10
      `);

      res.json({
        success: true,
        gameplayAnalytics: {
          scoreDistribution: scoreDistribution.rows,
          sessionMetrics: sessionMetrics.rows[0],
          skinUsage: skinUsage.rows,
          period: `${days} days`
        }
      });

    } catch (error) {
      logger.error('Gameplay analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch gameplay analytics' });
    }
  });

  /// 💰 Get monetization analytics
  router.get('/monetization', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 7, 30);

      // Revenue metrics
      const revenueMetrics = await db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as purchases,
          SUM(amount_usd) as daily_revenue,
          COUNT(DISTINCT player_id) as paying_players,
          AVG(amount_usd) as avg_purchase_amount
        FROM purchases
        WHERE status = 'completed'
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      // Conversion funnel
      const conversionFunnel = await db.query(`
        SELECT 
          COUNT(DISTINCT ae.player_id) as players_with_events,
          COUNT(DISTINCT p.player_id) as paying_players,
          CASE WHEN COUNT(DISTINCT ae.player_id) > 0 
               THEN (COUNT(DISTINCT p.player_id)::float / COUNT(DISTINCT ae.player_id) * 100)
               ELSE 0 END as conversion_rate
        FROM analytics_events ae
        LEFT JOIN purchases p ON ae.player_id = p.player_id 
          AND p.status = 'completed'
          AND p.created_at >= CURRENT_DATE - INTERVAL '${days} days'
        WHERE ae.created_at >= CURRENT_DATE - INTERVAL '${days} days'
      `);

      res.json({
        success: true,
        monetizationAnalytics: {
          dailyRevenue: revenueMetrics.rows,
          conversionMetrics: conversionFunnel.rows[0],
          period: `${days} days`
        }
      });

    } catch (error) {
      logger.error('Monetization analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch monetization analytics' });
    }
  });

  return router;
};
