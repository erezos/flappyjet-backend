/**
 * Tournament Scheduler Service
 * Automatically manages tournament lifecycle (start/end/create)
 */

const cron = require('node-cron');

class TournamentScheduler {
  constructor({ db, tournamentManager, wsManager }) {
    this.db = db;
    this.tournamentManager = tournamentManager;
    this.wsManager = wsManager;
    this.scheduledJobs = new Map();
    this.isRunning = false;
  }

  /**
   * Start the tournament scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('🏆 Tournament scheduler already running');
      return;
    }

    console.log('🏆 Starting tournament scheduler...');

    // Schedule weekly tournament creation (Sundays at 23:50 UTC)
    // Creates next week's tournament 10 minutes before current one ends
    this.scheduledJobs.set('create_weekly', cron.schedule('50 23 * * 0', async () => {
      await this._createNextWeeklyTournament();
    }, {
      scheduled: true,
      timezone: 'UTC'
    }));

    // Schedule tournament status checks (every 5 minutes)
    this.scheduledJobs.set('status_check', cron.schedule('*/5 * * * *', async () => {
      await this._checkTournamentStatuses();
    }, {
      scheduled: true,
      timezone: 'UTC'
    }));

    // Schedule tournament start checks (every minute during start hours)
    this.scheduledJobs.set('start_check', cron.schedule('* * * * 1', async () => {
      await this._checkTournamentStarts();
    }, {
      scheduled: true,
      timezone: 'UTC'
    }));

    // Schedule tournament end checks (every minute during end hours)
    this.scheduledJobs.set('end_check', cron.schedule('59 23 * * 0', async () => {
      await this._checkTournamentEnds();
    }, {
      scheduled: true,
      timezone: 'UTC'
    }));

    // Schedule cleanup of old tournament data (daily at 2 AM UTC)
    this.scheduledJobs.set('cleanup', cron.schedule('0 2 * * *', async () => {
      await this._cleanupOldTournaments();
    }, {
      scheduled: true,
      timezone: 'UTC'
    }));

    this.isRunning = true;
    console.log('🏆 ✅ Tournament scheduler started with 5 scheduled jobs');
  }

  /**
   * Stop the tournament scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log('🏆 Tournament scheduler not running');
      return;
    }

    console.log('🏆 Stopping tournament scheduler...');

    // Stop all scheduled jobs
    for (const [name, job] of this.scheduledJobs) {
      job.destroy();
      console.log(`🏆 ⏹️ Stopped job: ${name}`);
    }

    this.scheduledJobs.clear();
    this.isRunning = false;
    console.log('🏆 ✅ Tournament scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.scheduledJobs.keys()),
      nextExecutions: this._getNextExecutions()
    };
  }

  /**
   * Manually trigger tournament creation (for testing)
   */
  async createWeeklyTournamentNow(options = {}) {
    console.log('🏆 🔧 Manually creating weekly tournament...');
    return await this._createNextWeeklyTournament(options);
  }

  // Private methods

  async _createNextWeeklyTournament(options = {}) {
    try {
      console.log('🏆 📅 Creating next weekly tournament...');

      // Check if there's already an upcoming tournament
      const currentResult = await this.tournamentManager.getCurrentTournament();
      
      if (currentResult.success && currentResult.tournament) {
        const tournament = currentResult.tournament;
        
        // If there's already an upcoming tournament for next week, skip creation
        if (tournament.status === 'upcoming') {
          const startDate = new Date(tournament.start_date);
          const nextWeek = new Date();
          nextWeek.setDate(nextWeek.getDate() + 7);
          
          if (startDate > nextWeek) {
            console.log('🏆 ⏭️ Next weekly tournament already exists, skipping creation');
            return { success: true, skipped: true };
          }
        }
      }

      // Create new weekly tournament
      const defaultOptions = {
        prizePool: 1000,
        name: null, // Will be auto-generated
        startOffsetHours: 0
      };

      const tournamentOptions = { ...defaultOptions, ...options };
      const result = await this.tournamentManager.createWeeklyTournament(tournamentOptions);

      if (result.success) {
        console.log(`🏆 ✅ Created weekly tournament: ${result.tournament.name} (ID: ${result.tournament.id})`);
        
        // Notify via WebSocket
        if (this.wsManager) {
          await this.wsManager.broadcastGlobal({
            type: 'new_tournament_created',
            tournament: result.tournament,
            message: 'New weekly tournament is now available for registration!'
          });
        }

        return result;
      } else {
        console.error('🏆 ❌ Failed to create weekly tournament:', result.error);
        return result;
      }

    } catch (error) {
      console.error('🏆 ❌ Error in _createNextWeeklyTournament:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async _checkTournamentStatuses() {
    try {
      // Get all tournaments that might need status updates
      const query = `
        SELECT id, name, status, start_date, end_date
        FROM tournaments 
        WHERE status IN ('upcoming', 'active')
        ORDER BY start_date ASC
      `;

      const result = await this.db.query(query);
      const tournaments = result.rows;

      const now = new Date();

      for (const tournament of tournaments) {
        const startDate = new Date(tournament.start_date);
        const endDate = new Date(tournament.end_date);

        // Check if tournament should start
        if (tournament.status === 'upcoming' && now >= startDate) {
          console.log(`🏆 🚀 Auto-starting tournament: ${tournament.name}`);
          await this.tournamentManager.startTournament(tournament.id);
        }

        // Check if tournament should end
        if (tournament.status === 'active' && now >= endDate) {
          console.log(`🏆 🏁 Auto-ending tournament: ${tournament.name}`);
          await this.tournamentManager.endTournament(tournament.id);
        }
      }

    } catch (error) {
      console.error('🏆 ❌ Error checking tournament statuses:', error);
    }
  }

  async _checkTournamentStarts() {
    try {
      // More frequent check for tournaments starting soon (within 1 minute)
      const query = `
        SELECT id, name, start_date
        FROM tournaments 
        WHERE status = 'upcoming' 
          AND start_date <= NOW() + INTERVAL '1 minute'
          AND start_date > NOW() - INTERVAL '1 minute'
      `;

      const result = await this.db.query(query);
      
      for (const tournament of result.rows) {
        console.log(`🏆 🚀 Starting tournament: ${tournament.name}`);
        await this.tournamentManager.startTournament(tournament.id);
      }

    } catch (error) {
      console.error('🏆 ❌ Error checking tournament starts:', error);
    }
  }

  async _checkTournamentEnds() {
    try {
      // Check for tournaments ending soon (within 1 minute)
      const query = `
        SELECT id, name, end_date
        FROM tournaments 
        WHERE status = 'active' 
          AND end_date <= NOW() + INTERVAL '1 minute'
          AND end_date > NOW() - INTERVAL '1 minute'
      `;

      const result = await this.db.query(query);
      
      for (const tournament of result.rows) {
        console.log(`🏆 🏁 Ending tournament: ${tournament.name}`);
        await this.tournamentManager.endTournament(tournament.id);
      }

    } catch (error) {
      console.error('🏆 ❌ Error checking tournament ends:', error);
    }
  }

  async _cleanupOldTournaments() {
    try {
      console.log('🏆 🧹 Cleaning up old tournament data...');

      // Archive tournaments older than 3 months
      const archiveQuery = `
        UPDATE tournaments 
        SET status = 'archived'
        WHERE status = 'ended' 
          AND end_date < NOW() - INTERVAL '3 months'
      `;

      const archiveResult = await this.db.query(archiveQuery);
      
      if (archiveResult.rowCount > 0) {
        console.log(`🏆 📦 Archived ${archiveResult.rowCount} old tournaments`);
      }

      // Delete very old tournament events (older than 1 year)
      const deleteEventsQuery = `
        DELETE FROM tournament_events 
        WHERE created_at < NOW() - INTERVAL '1 year'
      `;

      const deleteEventsResult = await this.db.query(deleteEventsQuery);
      
      if (deleteEventsResult.rowCount > 0) {
        console.log(`🏆 🗑️ Deleted ${deleteEventsResult.rowCount} old tournament events`);
      }

      // Delete old leaderboard snapshots (keep only final ones for ended tournaments)
      const deleteSnapshotsQuery = `
        DELETE FROM tournament_leaderboards 
        WHERE is_final = false 
          AND snapshot_time < NOW() - INTERVAL '1 month'
      `;

      const deleteSnapshotsResult = await this.db.query(deleteSnapshotsQuery);
      
      if (deleteSnapshotsResult.rowCount > 0) {
        console.log(`🏆 🗑️ Deleted ${deleteSnapshotsResult.rowCount} old leaderboard snapshots`);
      }

      console.log('🏆 ✅ Tournament cleanup completed');

    } catch (error) {
      console.error('🏆 ❌ Error during tournament cleanup:', error);
    }
  }

  _getNextExecutions() {
    const nextExecutions = {};
    
    for (const [name, job] of this.scheduledJobs) {
      try {
        // Get next execution time (this is a simplified approach)
        // In a real implementation, you'd use a more sophisticated method
        nextExecutions[name] = 'Next execution time calculation not implemented';
      } catch (error) {
        nextExecutions[name] = 'Error calculating next execution';
      }
    }
    
    return nextExecutions;
  }

  /**
   * Emergency tournament operations
   */
  async emergencyEndAllActiveTournaments() {
    try {
      console.log('🏆 🚨 EMERGENCY: Ending all active tournaments...');

      const query = `
        SELECT id, name
        FROM tournaments 
        WHERE status = 'active'
      `;

      const result = await this.db.query(query);
      
      for (const tournament of result.rows) {
        console.log(`🏆 🚨 Emergency ending: ${tournament.name}`);
        await this.tournamentManager.endTournament(tournament.id);
      }

      console.log(`🏆 🚨 Emergency ended ${result.rows.length} tournaments`);
      return { success: true, count: result.rows.length };

    } catch (error) {
      console.error('🏆 ❌ Error in emergency tournament end:', error);
      return { success: false, error: error.message };
    }
  }

  async emergencyCreateTournament(options = {}) {
    try {
      console.log('🏆 🚨 EMERGENCY: Creating tournament immediately...');
      
      const result = await this.tournamentManager.createWeeklyTournament({
        ...options,
        startOffsetHours: 0 // Start immediately
      });

      if (result.success) {
        // Start the tournament immediately
        await this.tournamentManager.startTournament(result.tournament.id);
        console.log(`🏆 🚨 Emergency tournament created and started: ${result.tournament.name}`);
      }

      return result;

    } catch (error) {
      console.error('🏆 ❌ Error in emergency tournament creation:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = TournamentScheduler;
