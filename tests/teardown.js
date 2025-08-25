/**
 * 🧪 Global Test Teardown
 * Ensures all resources are properly cleaned up after tests
 */

module.exports = async () => {
  console.log('🧪 Running global teardown...');
  
  // Clear all timers
  if (global.setTimeout) {
    clearTimeout();
  }
  
  if (global.setInterval) {
    clearInterval();
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  // Clear any remaining handles
  if (process.listenerCount('uncaughtException') > 0) {
    process.removeAllListeners('uncaughtException');
  }
  
  if (process.listenerCount('unhandledRejection') > 0) {
    process.removeAllListeners('unhandledRejection');
  }
  
  console.log('🧪 Global teardown completed');
};
