/// 🎒 Inventory Routes - Skin synchronization and management
const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');

module.exports = (db) => {
  const router = express.Router();
  
  // Import auth middleware
  const authRoutes = require('./auth')(db);
  const authenticateToken = authRoutes.authenticateToken;

  // Validation schemas
  const syncSkinSchema = Joi.object({
    skinId: Joi.string().required().max(50),
    equipped: Joi.boolean().default(false),
    acquiredMethod: Joi.string().valid('purchase', 'iap_purchase', 'coin_purchase', 'reward', 'gift', 'daily_streak').default('purchase')
  });

  const syncBatchSchema = Joi.object({
    skins: Joi.array().items(Joi.object({
      skinId: Joi.string().required().max(50),
      equipped: Joi.boolean().default(false),
      acquiredMethod: Joi.string().valid('purchase', 'iap_purchase', 'coin_purchase', 'reward', 'gift', 'daily_streak').default('purchase')
    })).min(1).max(50).required()
  });

  /// 🎒 Sync single skin to backend inventory
  router.post('/sync-skin', authenticateToken, async (req, res) => {
    try {
      const { error, value } = syncSkinSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid request data',
          details: error.details[0].message 
        });
      }

      const { skinId, equipped, acquiredMethod } = value;
      const playerId = req.user.playerId;

      logger.info(`🎒 Syncing skin: ${skinId} for player ${playerId} (equipped: ${equipped})`);

      // Upsert skin in player_inventory
      const result = await db.query(`
        INSERT INTO player_inventory (player_id, item_type, item_id, equipped, acquired_method)
        VALUES ($1, 'skin', $2, $3, $4)
        ON CONFLICT (player_id, item_id) 
        DO UPDATE SET 
          equipped = $3, 
          acquired_method = $4,
          updated_at = NOW()
        RETURNING id, equipped, acquired_method, created_at, updated_at
      `, [playerId, skinId, equipped, acquiredMethod]);

      const inventoryItem = result.rows[0];

      // Log successful sync
      logger.info(`🎒 ✅ Skin synced successfully: ${skinId} for player ${playerId}`);

      res.json({ 
        success: true, 
        skinId,
        equipped: inventoryItem.equipped,
        acquiredMethod: inventoryItem.acquired_method,
        syncedAt: inventoryItem.updated_at || inventoryItem.created_at
      });

    } catch (error) {
      logger.error('🎒 ❌ Error syncing skin:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        message: 'Failed to sync skin to inventory'
      });
    }
  });

  /// 🎒 Sync multiple skins to backend inventory (batch operation)
  router.post('/sync-batch', authenticateToken, async (req, res) => {
    try {
      const { error, value } = syncBatchSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid request data',
          details: error.details[0].message 
        });
      }

      const { skins } = value;
      const playerId = req.user.playerId;

      logger.info(`🎒 Batch syncing ${skins.length} skins for player ${playerId}`);

      // Start transaction for batch operation
      const client = await db.getClient();
      
      try {
        await client.query('BEGIN');

        const syncedSkins = [];
        
        // Process each skin
        for (const skin of skins) {
          const { skinId, equipped, acquiredMethod } = skin;
          
          const result = await client.query(`
            INSERT INTO player_inventory (player_id, item_type, item_id, equipped, acquired_method)
            VALUES ($1, 'skin', $2, $3, $4)
            ON CONFLICT (player_id, item_id) 
            DO UPDATE SET 
              equipped = $3, 
              acquired_method = $4,
              updated_at = NOW()
            RETURNING id, item_id, equipped, acquired_method, created_at, updated_at
          `, [playerId, skinId, equipped, acquiredMethod]);

          const inventoryItem = result.rows[0];
          syncedSkins.push({
            skinId: inventoryItem.item_id,
            equipped: inventoryItem.equipped,
            acquiredMethod: inventoryItem.acquired_method,
            syncedAt: inventoryItem.updated_at || inventoryItem.created_at
          });
        }

        await client.query('COMMIT');

        logger.info(`🎒 ✅ Batch sync completed: ${syncedSkins.length} skins synced for player ${playerId}`);

        res.json({ 
          success: true, 
          syncedSkins,
          totalSynced: syncedSkins.length
        });

      } catch (transactionError) {
        await client.query('ROLLBACK');
        throw transactionError;
      } finally {
        client.release();
      }

    } catch (error) {
      logger.error('🎒 ❌ Error in batch skin sync:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        message: 'Failed to sync skins to inventory'
      });
    }
  });

  /// 🎒 Get player's current inventory status
  router.get('/status', authenticateToken, async (req, res) => {
    try {
      const playerId = req.user.playerId;

      const result = await db.query(`
        SELECT item_id, equipped, acquired_method, acquired_at, updated_at
        FROM player_inventory 
        WHERE player_id = $1 AND item_type = 'skin'
        ORDER BY acquired_at DESC
      `, [playerId]);

      const skins = result.rows.map(row => ({
        skinId: row.item_id,
        equipped: row.equipped,
        acquiredMethod: row.acquired_method,
        acquiredAt: row.acquired_at,
        updatedAt: row.updated_at
      }));

      logger.info(`🎒 Retrieved inventory status: ${skins.length} skins for player ${playerId}`);

      res.json({ 
        success: true, 
        skins,
        totalSkins: skins.length,
        equippedSkin: skins.find(s => s.equipped)?.skinId || null
      });

    } catch (error) {
      logger.error('🎒 ❌ Error getting inventory status:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        message: 'Failed to retrieve inventory status'
      });
    }
  });

  /// 🎒 Force sync all skins (for recovery scenarios)
  router.post('/force-sync', authenticateToken, async (req, res) => {
    try {
      const { skins } = req.body;
      const playerId = req.user.playerId;

      if (!skins || !Array.isArray(skins)) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid request data',
          message: 'skins array is required'
        });
      }

      logger.info(`🎒 Force syncing ${skins.length} skins for player ${playerId}`);

      // Clear existing skins for this player
      await db.query(`
        DELETE FROM player_inventory 
        WHERE player_id = $1 AND item_type = 'skin'
      `, [playerId]);

      // Insert all skins
      const client = await db.getClient();
      
      try {
        await client.query('BEGIN');

        for (const skin of skins) {
          await client.query(`
            INSERT INTO player_inventory (player_id, item_type, item_id, equipped, acquired_method)
            VALUES ($1, 'skin', $2, $3, $4)
          `, [playerId, skin.skinId, skin.equipped || false, skin.acquiredMethod || 'purchase']);
        }

        await client.query('COMMIT');

        logger.info(`🎒 ✅ Force sync completed: ${skins.length} skins synced for player ${playerId}`);

        res.json({ 
          success: true, 
          message: 'Force sync completed',
          totalSynced: skins.length
        });

      } catch (transactionError) {
        await client.query('ROLLBACK');
        throw transactionError;
      } finally {
        client.release();
      }

    } catch (error) {
      logger.error('🎒 ❌ Error in force sync:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        message: 'Failed to force sync inventory'
      });
    }
  });

  return router;
};
