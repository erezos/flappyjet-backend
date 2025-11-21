/**
 * Unit Tests for NotificationScheduler
 */

const NotificationScheduler = require('../../services/notification-scheduler');
const NotificationMessages = require('../../services/notification-messages');

describe('NotificationScheduler', () => {
  let scheduler;
  let mockDb;
  let mockFirebaseService;
  let mockFcmTokenManager;
  let mockNotificationTracker;

  beforeEach(() => {
    // Mock database
    mockDb = {
      query: jest.fn(),
    };

    // Mock Firebase service
    mockFirebaseService = {
      initialize: jest.fn().mockResolvedValue(),
      sendNotification: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
      }),
      isInvalidTokenError: jest.fn().mockReturnValue(false),
    };

    // Mock FCM token manager
    mockFcmTokenManager = {
      updateLastNotificationSent: jest.fn().mockResolvedValue(),
      deactivateToken: jest.fn().mockResolvedValue(),
    };

    // Mock notification tracker
    mockNotificationTracker = {
      markSent: jest.fn().mockResolvedValue(1),
      markFailed: jest.fn().mockResolvedValue(1),
    };

    scheduler = new NotificationScheduler({
      db: mockDb,
      firebaseMessagingService: mockFirebaseService,
      fcmTokenManager: mockFcmTokenManager,
      notificationTracker: mockNotificationTracker,
    });
  });

  describe('start()', () => {
    test('should start scheduler and register cron job', () => {
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
      expect(scheduler.scheduledJobs.size).toBe(1);
    });

    test('should not start if already running', () => {
      scheduler.start();
      const initialJobs = scheduler.scheduledJobs.size;
      scheduler.start();
      expect(scheduler.scheduledJobs.size).toBe(initialJobs);
    });

    test('should initialize Firebase service', () => {
      scheduler.start();
      expect(mockFirebaseService.initialize).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    test('should stop scheduler and clear jobs', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
      expect(scheduler.scheduledJobs.size).toBe(0);
    });

    test('should handle stop when not running', () => {
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('getStatus()', () => {
    test('should return scheduler status', () => {
      const status = scheduler.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('activeJobs');
    });
  });

  describe('_getRewardForNotification()', () => {
    test('should return coins or gems for 1hour', () => {
      const reward = scheduler._getRewardForNotification('1hour');
      expect(['coins', 'gems']).toContain(reward.type);
      expect(reward.amount).toBeGreaterThan(0);
    });

    test('should return coins or gems for 24hour', () => {
      const reward = scheduler._getRewardForNotification('24hour');
      expect(['coins', 'gems']).toContain(reward.type);
      expect(reward.amount).toBeGreaterThan(0);
    });

    test('should return coins or gems for 46hour', () => {
      const reward = scheduler._getRewardForNotification('46hour');
      expect(['coins', 'gems']).toContain(reward.type);
      expect(reward.amount).toBeGreaterThan(0);
    });

    test('should default to coins for unknown type', () => {
      const reward = scheduler._getRewardForNotification('unknown');
      expect(reward.type).toBe('coins');
      expect(reward.amount).toBe(100);
    });
  });
});

describe('NotificationMessages', () => {
  let messageService;

  beforeEach(() => {
    messageService = new NotificationMessages();
  });

  describe('getMessage()', () => {
    test('should return message for 1hour type', () => {
      const userContext = {
        nickname: 'TestPlayer',
        lastLevel: 5,
        currentStreak: 3,
        gamesPlayed: 10,
      };

      const message = messageService.getMessage('1hour', userContext);
      expect(message).toHaveProperty('title');
      expect(message).toHaveProperty('body');
      expect(message).toHaveProperty('variant');
      expect(message.title).toContain('🚀');
    });

    test('should return message for 24hour type', () => {
      const userContext = {
        nickname: 'TestPlayer',
        lastLevel: 5,
        currentStreak: 3,
        gamesPlayed: 10,
      };

      const message = messageService.getMessage('24hour', userContext);
      expect(message).toHaveProperty('title');
      expect(message).toHaveProperty('body');
      expect(message).toHaveProperty('variant');
    });

    test('should return message for 46hour type', () => {
      const userContext = {
        nickname: 'TestPlayer',
        lastLevel: 5,
        currentStreak: 3,
        gamesPlayed: 10,
      };

      const message = messageService.getMessage('46hour', userContext);
      expect(message).toHaveProperty('title');
      expect(message).toHaveProperty('body');
      expect(message).toHaveProperty('variant');
    });

    test('should personalize message with user context', () => {
      const userContext = {
        nickname: 'TestPlayer',
        lastLevel: 10,
        currentStreak: 5,
        gamesPlayed: 20,
      };

      const message = messageService.getMessage('1hour', userContext);
      expect(message.body).toContain('TestPlayer');
    });

    test('should handle missing user context gracefully', () => {
      const userContext = {
        nickname: null,
        lastLevel: null,
        currentStreak: null,
        gamesPlayed: null,
      };

      const message = messageService.getMessage('1hour', userContext);
      expect(message.title).toBeDefined();
      expect(message.body).toBeDefined();
    });
  });

  describe('_selectVariant()', () => {
    test('should select variant in round-robin fashion', () => {
      const userContext = { nickname: 'Test', lastLevel: 1, currentStreak: 0, gamesPlayed: 0 };
      
      const variants = [];
      for (let i = 0; i < 10; i++) {
        const message = messageService.getMessage('1hour', userContext);
        variants.push(message.variant);
      }

      // Should have multiple variants (round-robin)
      const uniqueVariants = [...new Set(variants)];
      expect(uniqueVariants.length).toBeGreaterThan(1);
    });
  });

  describe('_personalize()', () => {
    test('should replace nickname placeholder', () => {
      const message = messageService._personalize('Hello {{nickname}}!', {
        nickname: 'TestPlayer',
        lastLevel: 1,
        currentStreak: 0,
        gamesPlayed: 0,
      });
      expect(message).toBe('Hello TestPlayer!');
    });

    test('should replace level placeholder', () => {
      const message = messageService._personalize('Level {{lastLevel}}', {
        nickname: 'Test',
        lastLevel: 10,
        currentStreak: 0,
        gamesPlayed: 0,
      });
      expect(message).toBe('Level 10');
    });

    test('should replace streak placeholder', () => {
      const message = messageService._personalize('Streak: {{currentStreak}}', {
        nickname: 'Test',
        lastLevel: 1,
        currentStreak: 5,
        gamesPlayed: 0,
      });
      expect(message).toBe('Streak: 5');
    });

    test('should handle missing placeholders', () => {
      const message = messageService._personalize('Hello {{nickname}}!', {
        nickname: null,
        lastLevel: null,
        currentStreak: null,
        gamesPlayed: null,
      });
      expect(message).toBe('Hello Player!');
    });
  });
});

