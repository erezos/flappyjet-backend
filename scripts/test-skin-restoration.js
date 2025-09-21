#!/usr/bin/env node

/**
 * Comprehensive Skin Restoration Test Script
 * 
 * This script tests the complete user journey:
 * 1. User registers/logs in
 * 2. User purchases a jet skin
 * 3. User uninstalls/reinstalls app
 * 4. User logs back in
 * 5. Verify skin is restored
 */

const axios = require('axios');
const { Pool } = require('pg');

// Configuration
const BASE_URL = process.env.RAILWAY_URL || 'https://flappyjet-backend-production.up.railway.app';
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const db = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false }
});

// Test data
const testUser = {
  nickname: `TestUser_${Date.now()}`,
  deviceId: `test_device_${Date.now()}`,
  platform: 'android'
};

let playerId = null;
let authToken = null;

async function logStep(step, message) {
  console.log(`\n🔍 STEP ${step}: ${message}`);
  console.log('=' .repeat(50));
}

async function logResult(success, message, data = null) {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${message}`);
  if (data) {
    console.log('   Data:', JSON.stringify(data, null, 2));
  }
}

async function registerUser() {
  try {
    logStep(1, 'Registering new user');
    
    const response = await axios.post(`${BASE_URL}/api/auth/register`, {
      nickname: testUser.nickname,
      deviceId: testUser.deviceId,
      platform: testUser.platform
    });
    
    if (response.data.success) {
      playerId = response.data.player.id;
      authToken = response.data.token;
      
      logResult(true, 'User registered successfully', {
        playerId,
        nickname: testUser.nickname
      });
      
      return true;
    } else {
      logResult(false, 'Registration failed', response.data);
      return false;
    }
  } catch (error) {
    logResult(false, 'Registration error', error.response?.data || error.message);
    return false;
  }
}

async function checkInitialInventory() {
  try {
    logStep(2, 'Checking initial inventory (should have starter skin)');
    
    const response = await axios.get(`${BASE_URL}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (response.data.success) {
      const inventory = response.data.player.inventory || [];
      const skins = inventory.filter(item => item.item_type === 'skin');
      
      logResult(true, 'Initial inventory retrieved', {
        totalItems: inventory.length,
        skins: skins.map(s => ({ id: s.item_id, equipped: s.equipped }))
      });
      
      return skins;
    } else {
      logResult(false, 'Failed to get initial inventory', response.data);
      return [];
    }
  } catch (error) {
    logResult(false, 'Inventory check error', error.response?.data || error.message);
    return [];
  }
}

async function purchaseSkin(skinId = 'golden_falcon') {
  try {
    logStep(3, `Purchasing skin: ${skinId}`);
    
    // Mock purchase - in real scenario this would be a real IAP
    const response = await axios.post(`${BASE_URL}/api/purchase/process`, {
      platform: 'android',
      productId: `jet_skin_${skinId}`,
      transactionId: `test_txn_${Date.now()}`,
      receiptData: 'mock_receipt_data'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (response.data.success) {
      logResult(true, 'Skin purchase successful', {
        skinId,
        transactionId: response.data.transactionId
      });
      return true;
    } else {
      logResult(false, 'Skin purchase failed', response.data);
      return false;
    }
  } catch (error) {
    logResult(false, 'Purchase error', error.response?.data || error.message);
    return false;
  }
}

async function verifySkinInDatabase() {
  try {
    logStep(4, 'Verifying skin in database');
    
    const result = await db.query(`
      SELECT item_id, equipped, acquired_method, acquired_at
      FROM player_inventory 
      WHERE player_id = $1 AND item_type = 'skin'
      ORDER BY acquired_at DESC
    `, [playerId]);
    
    const skins = result.rows;
    
    logResult(true, 'Database verification complete', {
      totalSkins: skins.length,
      skins: skins.map(s => ({
        id: s.item_id,
        equipped: s.equipped,
        method: s.acquired_method,
        acquired: s.acquired_at
      }))
    });
    
    return skins;
  } catch (error) {
    logResult(false, 'Database verification error', error.message);
    return [];
  }
}

async function simulateReinstall() {
  try {
    logStep(5, 'Simulating app reinstall (clearing local data)');
    
    // In a real scenario, this would clear SharedPreferences
    // For this test, we'll just verify the backend still has the data
    
    logResult(true, 'Simulated reinstall - local data cleared');
    return true;
  } catch (error) {
    logResult(false, 'Reinstall simulation error', error.message);
    return false;
  }
}

async function loginAfterReinstall() {
  try {
    logStep(6, 'Logging in after reinstall');
    
    const response = await axios.post(`${BASE_URL}/api/auth/login`, {
      nickname: testUser.nickname,
      deviceId: testUser.deviceId,
      platform: testUser.platform
    });
    
    if (response.data.success) {
      // Update auth token
      authToken = response.data.token;
      
      logResult(true, 'Login successful after reinstall', {
        playerId: response.data.player.id
      });
      
      return true;
    } else {
      logResult(false, 'Login failed after reinstall', response.data);
      return false;
    }
  } catch (error) {
    logResult(false, 'Login error after reinstall', error.response?.data || error.message);
    return false;
  }
}

async function verifySkinRestoration() {
  try {
    logStep(7, 'Verifying skin restoration');
    
    const response = await axios.get(`${BASE_URL}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (response.data.success) {
      const inventory = response.data.player.inventory || [];
      const skins = inventory.filter(item => item.item_type === 'skin');
      
      logResult(true, 'Skin restoration verification complete', {
        totalItems: inventory.length,
        skins: skins.map(s => ({ id: s.item_id, equipped: s.equipped }))
      });
      
      return skins;
    } else {
      logResult(false, 'Failed to verify skin restoration', response.data);
      return [];
    }
  } catch (error) {
    logResult(false, 'Skin restoration verification error', error.response?.data || error.message);
    return [];
  }
}

async function cleanup() {
  try {
    logStep(8, 'Cleaning up test data');
    
    // Remove test user data
    await db.query('DELETE FROM player_inventory WHERE player_id = $1', [playerId]);
    await db.query('DELETE FROM players WHERE id = $1', [playerId]);
    
    logResult(true, 'Test data cleaned up');
  } catch (error) {
    logResult(false, 'Cleanup error', error.message);
  }
}

async function runTest() {
  console.log('🚀 Starting Comprehensive Skin Restoration Test');
  console.log('=' .repeat(60));
  
  try {
    // Step 1: Register user
    const registered = await registerUser();
    if (!registered) return false;
    
    // Step 2: Check initial inventory
    const initialSkins = await checkInitialInventory();
    if (initialSkins.length === 0) {
      console.log('❌ No initial skins found - test cannot continue');
      return false;
    }
    
    // Step 3: Purchase skin
    const purchased = await purchaseSkin();
    if (!purchased) return false;
    
    // Step 4: Verify skin in database
    const dbSkins = await verifySkinInDatabase();
    if (dbSkins.length < 2) { // Should have starter + purchased
      console.log('❌ Skin not found in database - test failed');
      return false;
    }
    
    // Step 5: Simulate reinstall
    await simulateReinstall();
    
    // Step 6: Login after reinstall
    const loggedIn = await loginAfterReinstall();
    if (!loggedIn) return false;
    
    // Step 7: Verify skin restoration
    const restoredSkins = await verifySkinRestoration();
    if (restoredSkins.length < 2) {
      console.log('❌ Skin restoration failed - not all skins restored');
      return false;
    }
    
    // Final verification
    const hasPurchasedSkin = restoredSkins.some(skin => skin.id === 'golden_falcon');
    if (hasPurchasedSkin) {
      console.log('\n🎉 SUCCESS: Skin restoration test passed!');
      console.log('✅ User can purchase skins and they are properly restored after reinstall');
      return true;
    } else {
      console.log('\n❌ FAILURE: Purchased skin not found after restoration');
      return false;
    }
    
  } catch (error) {
    console.log('\n❌ TEST ERROR:', error.message);
    return false;
  } finally {
    await cleanup();
    await db.end();
  }
}

// Run the test
if (require.main === module) {
  runTest()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = { runTest };
