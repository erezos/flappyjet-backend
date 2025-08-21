/// 🔧 Admin Routes - Administrative functions and monitoring
const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  /// 📊 Get system health
  router.get('/health', async (req, res) => {
    try {
      // Check database connection
      const dbHealth = await db.query('SELECT 1 as healthy');
      
      res.json({
        success: true,
        status: 'healthy',
        database: dbHealth.rows.length > 0 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        database: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  /// 📈 Get system statistics
  router.get('/stats', async (req, res) => {
    try {
      const stats = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM players) as total_players,
          (SELECT COUNT(*) FROM scores) as total_scores,
          (SELECT COUNT(*) FROM purchases WHERE status = 'completed') as total_purchases,
          (SELECT SUM(amount_usd) FROM purchases WHERE status = 'completed') as total_revenue
      `);

      res.json({
        success: true,
        stats: stats.rows[0]
      });

    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  return router;
};
