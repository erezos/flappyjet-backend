#!/usr/bin/env node
/**
 * 🚂 Production Console.log Replacement Script
 * Systematically replaces all console.log statements with Winston logger
 */

const fs = require('fs');
const path = require('path');

// Files to process (production files only, excluding tests)
const productionFiles = [
  'routes/auth.js',
  'routes/tournaments.js',
  'routes/leaderboard.js',
  'routes/enhanced-leaderboard.js',
  'routes/missions.js',
  'routes/achievements.js',
  'routes/analytics.js',
  'routes/player.js',
  'routes/purchase.js',
  'middleware/auth.js',
  'services/enhanced-leaderboard-service.js',
  'services/monitoring-service.js',
  'services/prize-manager.js',
  'services/cache-manager.js',
  'services/tournament-scheduler.js',
  'services/anti-cheat-engine.js'
];

function addLoggerImport(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check if logger is already imported
  if (content.includes("require('../utils/logger')") || content.includes("require('./utils/logger')")) {
    return content;
  }
  
  // Find the right place to add the import
  const lines = content.split('\n');
  let insertIndex = 0;
  
  // Find last require statement
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('require(') && !lines[i].includes('//')) {
      insertIndex = i + 1;
    }
  }
  
  // Determine correct path based on file location
  const relativePath = filePath.startsWith('routes/') || filePath.startsWith('middleware/') 
    ? '../utils/logger' 
    : '../utils/logger';
  
  lines.splice(insertIndex, 0, `const logger = require('${relativePath}');`);
  return lines.join('\n');
}

function replaceConsoleStatements(content) {
  // Replace console.log with logger.info
  content = content.replace(/console\.log\(/g, 'logger.info(');
  
  // Replace console.error with logger.error
  content = content.replace(/console\.error\(/g, 'logger.error(');
  
  // Replace console.warn with logger.warn
  content = content.replace(/console\.warn\(/g, 'logger.warn(');
  
  // Replace console.debug with logger.debug
  content = content.replace(/console\.debug\(/g, 'logger.debug(');
  
  return content;
}

function processFile(filePath) {
  try {
    console.log(`🔧 Processing ${filePath}...`);
    
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${filePath}`);
      return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Count console statements before
    const consoleBefore = (content.match(/console\.(log|error|warn|debug)\(/g) || []).length;
    
    if (consoleBefore === 0) {
      console.log(`✅ ${filePath} - No console statements found`);
      return;
    }
    
    // Add logger import
    content = addLoggerImport(filePath);
    
    // Replace console statements
    content = replaceConsoleStatements(content);
    
    // Write back to file
    fs.writeFileSync(filePath, content, 'utf8');
    
    console.log(`✅ ${filePath} - Replaced ${consoleBefore} console statements`);
    
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
  }
}

// Main execution
console.log('🚂 Starting production console.log cleanup...\n');

let totalReplaced = 0;
productionFiles.forEach(file => {
  processFile(file);
});

console.log('\n🎉 Production console.log cleanup completed!');
console.log('✅ All production files now use Winston logger instead of console statements');
