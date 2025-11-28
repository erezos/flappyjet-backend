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
      '1hour': { A: 0, B: 0, C: 0, D: 0, E: 0 },
      '24hour': { A: 0, B: 0, C: 0, D: 0, E: 0 },
      '46hour': { A: 0, B: 0, C: 0, D: 0, E: 0 },
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
   * ✅ OPTIMIZED: All variants now lead with specific reward value
   */
  _get1HourTemplates() {
    return [
      {
        variant: 'A',
        title: '50 coins waiting! 🚀',
        body: '{{nickname}}, tap now to claim before they expire!',
      },
      {
        variant: 'B',
        title: 'Claim 50 coins + streak! 🔥',
        body: '{{nickname}}, keep your {{currentStreak}}-day streak alive!',
      },
      {
        variant: 'C',
        title: 'Free 50 coins inside! ✈️',
        body: '{{nickname}}, your bonus expires soon - claim now!',
      },
      {
        variant: 'D',
        title: '{{nickname}}, 50 coins ready! 🛩️',
        body: 'Tap to claim + continue level {{lastLevel}}!',
      },
      {
        variant: 'E',
        title: '50 coins + bonus gems! 💎',
        body: '{{nickname}}, claim now before time runs out!',
      },
    ];
  }

  /**
   * 24 Hour Notification Templates
   * Goal: Daily habit building (8-12% CTR target)
   * ✅ OPTIMIZED: All variants lead with specific reward value
   */
  _get24HourTemplates() {
    return [
      {
        variant: 'A',
        title: '100 coins - claim now! 💰',
        body: '{{nickname}}, your daily bonus expires at midnight!',
      },
      {
        variant: 'B',
        title: 'Free 100 coins + gems! 🎁',
        body: '{{nickname}}, don\'t miss today\'s daily reward!',
      },
      {
        variant: 'C',
        title: '{{nickname}}: 100 coins ready! ✨',
        body: 'Tap to collect your daily bonus now!',
      },
      {
        variant: 'D',
        title: 'Daily 100 coins waiting! 🛩️',
        body: '{{nickname}}, claim + continue level {{lastLevel}}!',
      },
      {
        variant: 'E',
        title: '100 coins + streak bonus! 🔥',
        body: '{{nickname}}, collect before your streak resets!',
      },
    ];
  }

  /**
   * 46 Hour Notification Templates
   * Goal: Win-back campaign (5-8% CTR target)
   * ✅ OPTIMIZED: Big rewards + personalization + urgency
   */
  _get46HourTemplates() {
    return [
      {
        variant: 'A',
        title: '500 coins + 10 gems FREE! 🎁',
        body: '{{nickname}}, your comeback gift expires soon!',
      },
      {
        variant: 'B',
        title: 'FREE premium jet unlock! ✈️',
        body: '{{nickname}}, claim your exclusive comeback reward!',
      },
      {
        variant: 'C',
        title: '{{nickname}}: 500 coins saved! 💰',
        body: 'We held your comeback bonus - claim it now!',
      },
      {
        variant: 'D',
        title: 'Special: 500 coins + gems! 🚀',
        body: '{{nickname}}, your welcome back gift is waiting!',
      },
      {
        variant: 'E',
        title: '{{nickname}}, 500+ coins! 🔥',
        body: 'Comeback bonus + level {{lastLevel}} rewards!',
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

