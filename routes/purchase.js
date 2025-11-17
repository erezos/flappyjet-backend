/// 💰 Purchase Routes - IAP validation and purchase management
const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');

module.exports = (db) => {
  const router = express.Router();

  // Validation schemas
  const validatePurchaseSchema = Joi.object({
    productId: Joi.string().required().max(100),
    transactionId: Joi.string().required().max(255),
    platform: Joi.string().valid('ios', 'android', 'web').required(),
    receiptData: Joi.string().optional(),
    amountUsd: Joi.number().min(0).max(999.99).optional(),
    currencyCode: Joi.string().length(3).default('USD')
  });

  /// 💰 Validate IAP purchase (NO AUTH - device-based identity from event data)
  router.post('/validate', async (req, res) => {
    try {
      const { error, value } = validatePurchaseSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const {
        productId,
        transactionId,
        platform,
        receiptData,
        amountUsd,
        currencyCode
      } = value;

      // Check if transaction already processed
      const existingPurchase = await db.query(`
        SELECT id, status, items_granted
        FROM purchases
        WHERE platform = $1 AND transaction_id = $2
      `, [platform, transactionId]);

      if (existingPurchase.rows.length > 0) {
        const existing = existingPurchase.rows[0];
        if (existing.status === 'completed') {
          return res.json({
            success: true,
            alreadyProcessed: true,
            purchaseId: existing.id,
            itemsGranted: existing.items_granted
          });
        }
      }

      // Validate receipt with platform store (mock implementation)
      const validationResult = await validateReceiptWithStore(platform, receiptData, productId);
      
      if (!validationResult.valid) {
        // Record failed purchase
        await db.query(`
          INSERT INTO purchases (
            player_id, product_id, platform, transaction_id, 
            receipt_data, amount_usd, currency_code, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed')
        `, [req.playerId, productId, platform, transactionId, receiptData, amountUsd, currencyCode]);

        return res.status(400).json({ 
          error: 'Purchase validation failed',
          reason: validationResult.reason 
        });
      }

      // Determine items to grant based on product ID
      const itemsToGrant = getItemsForProduct(productId);
      
      if (!itemsToGrant) {
        return res.status(400).json({ error: 'Unknown product ID' });
      }

      // Record successful purchase
      const purchase = await db.query(`
        INSERT INTO purchases (
          player_id, product_id, platform, transaction_id, 
          receipt_data, amount_usd, currency_code, status, items_granted, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, NOW())
        RETURNING id, created_at
      `, [
        req.playerId, productId, platform, transactionId, 
        receiptData, amountUsd, currencyCode, JSON.stringify(itemsToGrant)
      ]);

      // Grant items to player
      await grantItemsToPlayer(req.playerId, itemsToGrant, db);

      // Log purchase for analytics
      await db.query(`
        INSERT INTO analytics_events (player_id, event_name, event_category, parameters)
        VALUES ($1, 'purchase_completed', 'monetization', $2)
      `, [req.playerId, JSON.stringify({
        productId,
        platform,
        amountUsd,
        itemsGranted: itemsToGrant
      })]);

      res.json({
        success: true,
        purchaseId: purchase.rows[0].id,
        itemsGranted: itemsToGrant,
        processedAt: purchase.rows[0].created_at
      });

    } catch (error) {
      logger.error('Purchase validation error:', error);
      res.status(500).json({ error: 'Failed to validate purchase' });
    }
  });

  /// 📜 Get purchase history (NO AUTH - requires user_id in query param)
  router.get('/history', async (req, res) => {
    try {
      const userId = req.query.user_id; // ✅ Device-based identity
      
      if (!userId) {
        return res.status(400).json({ error: 'user_id is required' });
      }
      
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);

      const purchases = await db.query(`
        SELECT 
          id, product_id, platform, amount_usd, currency_code,
          status, items_granted, created_at, processed_at
        FROM purchases
        WHERE player_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);

      const totalCount = await db.query(`
        SELECT COUNT(*) as total
        FROM purchases
        WHERE player_id = $1
      `, [userId]);

      res.json({
        success: true,
        purchases: purchases.rows,
        pagination: {
          limit,
          offset,
          total: parseInt(totalCount.rows[0].total)
        }
      });

    } catch (error) {
      logger.error('Purchase history error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase history' });
    }
  });

  /// 📊 Get purchase statistics (admin)
  router.get('/stats', async (req, res) => {
    try {
      // Basic purchase stats
      const stats = await db.query(`
        SELECT 
          COUNT(*) as total_purchases,
          COUNT(*) FILTER (WHERE status = 'completed') as successful_purchases,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_purchases,
          SUM(amount_usd) FILTER (WHERE status = 'completed') as total_revenue,
          COUNT(DISTINCT player_id) FILTER (WHERE status = 'completed') as paying_players,
          AVG(amount_usd) FILTER (WHERE status = 'completed') as average_purchase_amount
        FROM purchases
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      `);

      // Top products
      const topProducts = await db.query(`
        SELECT 
          product_id,
          COUNT(*) as purchase_count,
          SUM(amount_usd) as revenue
        FROM purchases
        WHERE status = 'completed' 
          AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY product_id
        ORDER BY revenue DESC
        LIMIT 10
      `);

      // Platform breakdown
      const platformStats = await db.query(`
        SELECT 
          platform,
          COUNT(*) as purchase_count,
          SUM(amount_usd) as revenue
        FROM purchases
        WHERE status = 'completed'
          AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY platform
        ORDER BY revenue DESC
      `);

      res.json({
        success: true,
        stats: {
          ...stats.rows[0],
          total_revenue: parseFloat(stats.rows[0].total_revenue || 0),
          average_purchase_amount: parseFloat(stats.rows[0].average_purchase_amount || 0),
          topProducts: topProducts.rows,
          platformBreakdown: platformStats.rows
        }
      });

    } catch (error) {
      logger.error('Purchase stats error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase statistics' });
    }
  });

  return router;
};

/// 🏪 Product catalog and item granting
function getItemsForProduct(productId) {
  const products = {
    // 💎 Gem packs - Aligned with Google Play Console
    'gems_pack_small': { gems: 100 },
    'gems_pack_medium': { gems: 500, bonusGems: 50 },
    'gems_pack_large': { gems: 1000, bonusGems: 200 },
    'gems_pack_mega': { gems: 2500, bonusGems: 750 },
    
    // ⚡ Heart boosters - Complete lineup
    'heart_booster_24h': { heartBoosterHours: 24 },
    'heart_booster_48h': { heartBoosterHours: 48 },
    'heart_booster_72h': { heartBoosterHours: 72 },
    
    // 🚁 Premium jet skins
    'jet_golden_falcon': { jetSkin: 'golden_falcon' },
    'jet_stealth_dragon': { jetSkin: 'stealth_dragon' },
    'jet_phoenix_flame': { jetSkin: 'phoenix_flame' },
    
    // 🎁 Convenience packs
    'hearts_instant_refill': { hearts: 3 },
    'starter_bundle': { gems: 200, coins: 1000, hearts: 5, heartBoosterHours: 24 },
    
    // Legacy support (keep for backward compatibility)
    'coins_pack_small': { coins: 1000 },
    'coins_pack_large': { coins: 5000, bonusCoins: 1000 },
    'jet_skin_golden_falcon': { jetSkin: 'golden_falcon' },
    'jet_skin_diamond_elite': { jetSkin: 'diamond_elite' },
    'starter_pack': { gems: 200, coins: 2000, heartBoosterHours: 48 },
    'mega_bundle': { gems: 1000, coins: 10000, jetSkin: 'premium_bundle_jet' }
  };

  return products[productId] || null;
}

async function grantItemsToPlayer(playerId, items, db) {
  const updates = [];
  const values = [playerId];
  let paramCount = 1;

  // Grant gems
  if (items.gems || items.bonusGems) {
    const totalGems = (items.gems || 0) + (items.bonusGems || 0);
    updates.push(`current_gems = current_gems + $${++paramCount}`);
    values.push(totalGems);
  }

  // Grant coins
  if (items.coins || items.bonusCoins) {
    const totalCoins = (items.coins || 0) + (items.bonusCoins || 0);
    updates.push(`current_coins = current_coins + $${++paramCount}`);
    values.push(totalCoins);
  }

  // Grant hearts (instant refill)
  if (items.hearts) {
    updates.push(`current_hearts = LEAST(current_hearts + $${++paramCount}, max_hearts)`);
    values.push(items.hearts);
  }

  // Grant heart booster
  if (items.heartBoosterHours) {
    const boosterExpiry = new Date();
    boosterExpiry.setHours(boosterExpiry.getHours() + items.heartBoosterHours);
    
    updates.push(`heart_booster_expiry = GREATEST(COALESCE(heart_booster_expiry, NOW()), NOW()) + INTERVAL '${items.heartBoosterHours} hours'`);
  }

  // Update player currencies and boosters
  if (updates.length > 0) {
    const updateQuery = `
      UPDATE players 
      SET ${updates.join(', ')}
      WHERE id = $1
    `;
    await db.query(updateQuery, values);
  }

  // Grant jet skin
  if (items.jetSkin) {
    await db.query(`
      INSERT INTO player_inventory (player_id, item_type, item_id, acquired_method)
      VALUES ($1, 'skin', $2, 'purchase')
      ON CONFLICT (player_id, item_id) DO NOTHING
    `, [playerId, items.jetSkin]);
  }
}

/// 🔍 Receipt validation (mock implementation)
async function validateReceiptWithStore(platform, receiptData, productId) {
  // In production, this would validate with Apple App Store or Google Play Store
  
  // Mock validation - always return valid for testing
  if (process.env.NODE_ENV === 'test') {
    return { valid: true };
  }

  // Basic validation checks
  if (!receiptData || receiptData.length < 10) {
    return { valid: false, reason: 'Invalid receipt data' };
  }

  if (platform === 'ios') {
    // Would validate with Apple's validation endpoint
    return await validateAppleReceipt(receiptData, productId);
  } else if (platform === 'android') {
    // Would validate with Google Play's validation API
    return await validateGoogleReceipt(receiptData, productId);
  }

  return { valid: false, reason: 'Unsupported platform' };
}

async function validateAppleReceipt(receiptData, productId) {
  // Mock Apple receipt validation
  // In production: POST to https://buy.itunes.apple.com/verifyReceipt
  return { valid: true };
}

async function validateGoogleReceipt(receiptData, productId) {
  // Mock Google Play receipt validation  
  // In production: Use Google Play Developer API
  return { valid: true };
}
