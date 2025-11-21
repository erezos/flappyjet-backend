/**
 * Unit Tests for Firebase Messaging Service
 */

const firebaseMessagingService = require('../../services/firebase-messaging-service');

describe('FirebaseMessagingService', () => {
  describe('Token Validation', () => {
    it('should validate correct FCM token format', () => {
      const validToken = 'a'.repeat(150); // FCM tokens are 140+ chars
      expect(firebaseMessagingService.isValidTokenFormat(validToken)).toBe(true);
    });

    it('should reject short tokens', () => {
      const shortToken = 'abc123';
      expect(firebaseMessagingService.isValidTokenFormat(shortToken)).toBe(false);
    });

    it('should reject null/undefined tokens', () => {
      expect(firebaseMessagingService.isValidTokenFormat(null)).toBe(false);
      expect(firebaseMessagingService.isValidTokenFormat(undefined)).toBe(false);
      expect(firebaseMessagingService.isValidTokenFormat('')).toBe(false);
    });

    it('should reject non-string tokens', () => {
      expect(firebaseMessagingService.isValidTokenFormat(12345)).toBe(false);
      expect(firebaseMessagingService.isValidTokenFormat({})).toBe(false);
      expect(firebaseMessagingService.isValidTokenFormat([])).toBe(false);
    });
  });

  describe('Error Detection', () => {
    it('should detect invalid token errors', () => {
      const invalidTokenError = {
        code: 'messaging/invalid-registration-token',
        message: 'Invalid token',
      };
      expect(firebaseMessagingService.isInvalidTokenError(invalidTokenError)).toBe(true);
    });

    it('should detect unregistered token errors', () => {
      const unregisteredError = {
        code: 'messaging/registration-token-not-registered',
        message: 'Token not registered',
      };
      expect(firebaseMessagingService.isInvalidTokenError(unregisteredError)).toBe(true);
    });

    it('should not flag other errors as invalid token', () => {
      const otherError = {
        code: 'messaging/server-error',
        message: 'Server error',
      };
      expect(firebaseMessagingService.isInvalidTokenError(otherError)).toBe(false);
    });

    it('should handle null/undefined errors', () => {
      expect(firebaseMessagingService.isInvalidTokenError(null)).toBe(false);
      expect(firebaseMessagingService.isInvalidTokenError(undefined)).toBe(false);
    });
  });

  describe('Initialization', () => {
    it('should not throw when FIREBASE_SERVICE_ACCOUNT is missing', async () => {
      // Save original env
      const originalEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
      delete process.env.FIREBASE_SERVICE_ACCOUNT;

      // Should not throw, just log warning
      await expect(firebaseMessagingService.initialize()).resolves.not.toThrow();

      // Restore env
      if (originalEnv) {
        process.env.FIREBASE_SERVICE_ACCOUNT = originalEnv;
      }
    });
  });
});

