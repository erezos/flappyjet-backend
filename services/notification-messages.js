/**
 * Notification Message Templates
 * Provides personalized message variants for push notifications
 * 
 * Features:
 * - Multiple variants per notification type (friendly, casual, professional)
 * - Personalization with nickname, level, streak
 * - Emoji usage for engagement
 * - Industry best practices (under 65 chars for full visibility)
 */

class NotificationMessages {
  constructor() {
    // Cache for variant selection (ensures good distribution)
    this.variantCounters = {
      '1hour': { A: 0, B: 0, C: 0 },
      '24hour': { A: 0, B: 0, C: 0 },
      '46hour': { A: 0, B: 0, C: 0 },
    };
  }

  /**
   * Get a message for notification type with personalization
   * 
   * @param {string} notificationType - '1hour', '24hour', or '46hour'
   * @param {Object} userContext - { nickname, lastLevel, currentStreak, gamesPlayed }
   * @returns {Object} - { title, body, variant }
   */
  getMessage(notificationType, userContext) {
    const templates = this._getTemplates(notificationType);
    
    // Select variant (round-robin for even distribution)
    const variant = this._selectVariant(notificationType);
    const template = templates.find(t => t.variant === variant) || templates[0];

    // Personalize message
    return {
      title: this._personalize(template.title, userContext),
      body: this._personalize(template.body, userContext),
      variant: template.variant,
    };
  }

  /**
   * Get templates for notification type
   * 
   * @param {string} notificationType - '1hour', '24hour', or '46hour'
   * @returns {Array} - Array of template objects
   */
  _getTemplates(notificationType) {
    switch (notificationType) {
      case '1hour':
        return this._get1HourTemplates();
      case '24hour':
        return this._get24HourTemplates();
      case '46hour':
        return this._get46HourTemplates();
      default:
        return this._get1HourTemplates();
    }
  }

  /**
   * 1 Hour Notification Templates
   * Goal: Immediate re-engagement (12-18% CTR target)
   */
  _get1HourTemplates() {
    return [
      {
        variant: 'A',
        title: 'Quick! Your jet is ready! 🚀',
        body: '{{nickname}}, level {{lastLevel}} is waiting!',
      },
      {
        variant: 'B',
        title: "Don't lose your streak! 🔥",
        body: 'Keep your {{currentStreak}}-day streak alive!',
      },
      {
        variant: 'C',
        title: 'Ready for another flight? ✈️',
        body: '{{nickname}}, come back and keep flying!',
      },
      {
        variant: 'D',
        title: 'Your jet misses you! 🛩️',
        body: 'Level {{lastLevel}} needs your skills!',
      },
      {
        variant: 'E',
        title: 'Quick break? Time to fly! 🚀',
        body: '{{nickname}}, claim your reward now!',
      },
    ];
  }

  /**
   * 24 Hour Notification Templates
   * Goal: Daily habit building (8-12% CTR target)
   */
  _get24HourTemplates() {
    return [
      {
        variant: 'A',
        title: 'Miss flying today? 🛩️',
        body: 'Claim your daily bonus of 100 coins! ✨',
      },
      {
        variant: 'B',
        title: 'Daily reward waiting! 🎁',
        body: '{{nickname}}, don\'t miss your free gems!',
      },
      {
        variant: 'C',
        title: 'Your daily bonus is here! 💰',
        body: 'Come back and collect your reward!',
      },
      {
        variant: 'D',
        title: 'Time for your daily flight! ✈️',
        body: '{{nickname}}, level {{lastLevel}} awaits!',
      },
      {
        variant: 'E',
        title: 'Daily challenge ready! 🎯',
        body: 'Keep your streak going, Pilot!',
      },
    ];
  }

  /**
   * 46 Hour Notification Templates
   * Goal: Win-back campaign (5-8% CTR target)
   */
  _get46HourTemplates() {
    return [
      {
        variant: 'A',
        title: 'We miss you, Pilot! 😢',
        body: 'Special comeback: 500 coins + 10 gems!',
      },
      {
        variant: 'B',
        title: 'Your jets are lonely! ✈️',
        body: 'Come back and unlock a FREE premium jet!',
      },
      {
        variant: 'C',
        title: 'Comeback bonus waiting! 🎁',
        body: '{{nickname}}, we saved a reward for you!',
      },
      {
        variant: 'D',
        title: 'Ready to fly again? 🚀',
        body: 'Special welcome back gift inside!',
      },
      {
        variant: 'E',
        title: 'Your progress is waiting! 📈',
        body: 'Level {{lastLevel}} + bonus rewards!',
      },
    ];
  }

  /**
   * Select variant using round-robin for even distribution
   * 
   * @param {string} notificationType - '1hour', '24hour', or '46hour'
   * @returns {string} - Variant letter (A, B, C, etc.)
   */
  _selectVariant(notificationType) {
    const templates = this._getTemplates(notificationType);
    const counters = this.variantCounters[notificationType];

    // Find variant with lowest count (round-robin)
    let selectedVariant = 'A';
    let minCount = Infinity;

    for (const template of templates) {
      const count = counters[template.variant] || 0;
      if (count < minCount) {
        minCount = count;
        selectedVariant = template.variant;
      }
    }

    // Increment counter
    counters[selectedVariant] = (counters[selectedVariant] || 0) + 1;

    return selectedVariant;
  }

  /**
   * Personalize message with user context
   * 
   * @param {string} message - Message template
   * @param {Object} userContext - { nickname, lastLevel, currentStreak, gamesPlayed }
   * @returns {string} - Personalized message
   */
  _personalize(message, userContext) {
    let personalized = message;

    // Replace placeholders
    personalized = personalized.replace(/\{\{nickname\}\}/g, userContext.nickname || 'Player');
    personalized = personalized.replace(/\{\{lastLevel\}\}/g, (userContext.lastLevel || 1).toString());
    personalized = personalized.replace(/\{\{currentStreak\}\}/g, (userContext.currentStreak || 0).toString());
    personalized = personalized.replace(/\{\{gamesPlayed\}\}/g, (userContext.gamesPlayed || 0).toString());

    return personalized;
  }
}

module.exports = NotificationMessages;

