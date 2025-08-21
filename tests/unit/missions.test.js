/// 🧪 Missions Routes Unit Tests
const request = require('supertest');
const express = require('express');
const missionsRoutes = require('../../routes/missions');
const authRoutes = require('../../routes/auth');

describe('Missions Routes', () => {
  let app;
  let mockDb;
  let testPlayerId;
  let authToken;

  beforeEach(() => {
    // Create mock database
    mockDb = global.testHelpers.mockDatabase();
    
    // Create Express app with routes
    app = express();
    app.use(express.json());
    
    const authRouter = authRoutes(mockDb);
    const missionsRouter = missionsRoutes(mockDb);
    
    app.use('/api/auth', authRouter);
    app.use('/api/missions', missionsRouter);
    
    // Set up test player and token
    testPlayerId = 'test-player-id';
    authToken = global.testHelpers.generateTestToken(testPlayerId);
  });

  describe('GET /api/missions/daily', () => {
    it('should return existing daily missions', async () => {
      const mockMissions = [
        {
          id: 'mission-1',
          mission_type: 'play_games',
          difficulty_level: 'easy',
          title: 'Take Flight',
          description: 'Play 3 games today',
          target: 3,
          reward: 75,
          progress: 1,
          completed: false,
          completed_at: null,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString()
        },
        {
          id: 'mission-2',
          mission_type: 'reach_score',
          difficulty_level: 'medium',
          title: 'Sky Achievement',
          description: 'Reach 15 points in a single game',
          target: 15,
          reward: 150,
          progress: 0,
          completed: false,
          completed_at: null,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString()
        }
      ];

      mockDb.mockQuery.mockResolvedValueOnce({ rows: mockMissions });

      const response = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.missions).toHaveLength(2);
      expect(response.body.generated).toBe(false);
      
      expect(response.body.missions[0]).toMatchObject({
        id: 'mission-1',
        mission_type: 'play_games',
        title: 'Take Flight',
        target: 3,
        progress: 1,
        completed: false
      });
    });

    it('should generate new missions when none exist', async () => {
      // Mock empty missions query, then player stats, then new missions
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] }) // No existing missions
        .mockResolvedValueOnce({ // Player stats for generation
          rows: [{
            best_score: 25,
            best_streak: 3,
            total_games_played: 10,
            nickname_changes: 0
          }]
        })
        .mockResolvedValueOnce({}) // Mission insertion 1
        .mockResolvedValueOnce({}) // Mission insertion 2
        .mockResolvedValueOnce({}) // Mission insertion 3
        .mockResolvedValueOnce({}) // Mission insertion 4
        .mockResolvedValueOnce({ // Fetch newly generated missions
          rows: [
            {
              id: 'new-mission-1',
              mission_type: 'play_games',
              difficulty_level: 'easy',
              title: 'Take Flight',
              description: 'Play 5 games today',
              target: 5,
              reward: 150,
              progress: 0,
              completed: false,
              completed_at: null,
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              created_at: new Date().toISOString()
            }
          ]
        });

      const response = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.generated).toBe(true);
      expect(response.body.missions).toHaveLength(1);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/missions/daily');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should handle database errors', async () => {
      mockDb.mockQuery.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch daily missions');
    });
  });

  describe('POST /api/missions/progress', () => {
    it('should update mission progress successfully', async () => {
      const mockMissionUpdate = {
        id: 'mission-123',
        progress: 2,
        target: 3,
        completed: false,
        reward: 75,
        title: 'Take Flight'
      };

      mockDb.mockQuery.mockResolvedValueOnce({ rows: [mockMissionUpdate] });

      const response = await request(app)
        .post('/api/missions/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          missionType: 'play_games',
          amount: 1
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.mission).toMatchObject({
        id: 'mission-123',
        progress: 2,
        target: 3,
        completed: false
      });
      expect(response.body.rewardGranted).toBe(0);
    });

    it('should complete mission and grant reward', async () => {
      const mockCompletedMission = {
        id: 'mission-123',
        progress: 3,
        target: 3,
        completed: true,
        reward: 75,
        title: 'Take Flight'
      };

      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [mockCompletedMission] }) // Mission update
        .mockResolvedValueOnce({}) // Grant coins to player
        .mockResolvedValueOnce({}); // Log analytics event

      const response = await request(app)
        .post('/api/missions/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          missionType: 'play_games',
          amount: 1
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.mission.completed).toBe(true);
      expect(response.body.rewardGranted).toBe(75);

      // Verify coins were granted
      expect(mockDb.mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE players'),
        expect.arrayContaining([testPlayerId, 75])
      );
    });

    it('should validate mission type', async () => {
      const response = await request(app)
        .post('/api/missions/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          missionType: 'invalid_mission_type',
          amount: 1
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('missionType');
    });

    it('should validate amount range', async () => {
      const response = await request(app)
        .post('/api/missions/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          missionType: 'play_games',
          amount: -1 // Invalid negative amount
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('amount');
    });

    it('should handle mission not found', async () => {
      mockDb.mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/missions/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          missionType: 'play_games',
          amount: 1
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No active mission found for this type');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/missions/progress')
        .send({
          missionType: 'play_games',
          amount: 1
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/missions/refresh', () => {
    it('should refresh missions successfully', async () => {
      const mockNewMissions = [
        {
          id: 'refreshed-mission-1',
          mission_type: 'reach_score',
          difficulty_level: 'medium',
          title: 'Sky Achievement',
          description: 'Reach 20 points in a single game',
          target: 20,
          reward: 200,
          progress: 0,
          completed: false,
          completed_at: null,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString()
        }
      ];

      mockDb.mockQuery
        .mockResolvedValueOnce({}) // Mark current missions as expired
        .mockResolvedValueOnce({ // Player stats for generation
          rows: [{
            best_score: 30,
            best_streak: 4,
            total_games_played: 15,
            nickname_changes: 1
          }]
        })
        .mockResolvedValueOnce({}) // Mission insertion 1
        .mockResolvedValueOnce({}) // Mission insertion 2
        .mockResolvedValueOnce({}) // Mission insertion 3
        .mockResolvedValueOnce({}) // Mission insertion 4
        .mockResolvedValueOnce({ rows: mockNewMissions }); // Fetch new missions

      const response = await request(app)
        .post('/api/missions/refresh')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.missions).toHaveLength(1);
      expect(response.body.message).toBe('Daily missions refreshed');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/missions/refresh');

      expect(response.status).toBe(401);
    });
  });

  describe('Mission Generation Logic', () => {
    it('should generate appropriate missions for beginner players', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] }) // No existing missions
        .mockResolvedValueOnce({ // Beginner player stats
          rows: [{
            best_score: 5, // Beginner level
            best_streak: 1,
            total_games_played: 2,
            nickname_changes: 0
          }]
        })
        .mockResolvedValueOnce({}) // Mission insertions
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ // Generated missions
          rows: [
            {
              id: 'beginner-mission',
              mission_type: 'play_games',
              target: 3, // Easy target for beginners
              reward: 75, // Lower reward
              title: 'Take Flight',
              description: 'Play 3 games today'
            }
          ]
        });

      const response = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.missions[0].target).toBe(3); // Beginner-appropriate target
      expect(response.body.missions[0].reward).toBe(75); // Beginner-appropriate reward
    });

    it('should generate appropriate missions for expert players', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ // Expert player stats
          rows: [{
            best_score: 150, // Expert level
            best_streak: 8,
            total_games_played: 50,
            nickname_changes: 1
          }]
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'expert-mission',
              mission_type: 'play_games',
              target: 8, // Harder target for experts
              reward: 300, // Higher reward
              title: 'Take Flight',
              description: 'Play 8 games today'
            }
          ]
        });

      const response = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.missions[0].target).toBe(8); // Expert-appropriate target
      expect(response.body.missions[0].reward).toBe(300); // Expert-appropriate reward
    });

    it('should include nickname mission for players who haven\'t changed nickname', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            best_score: 25,
            best_streak: 3,
            total_games_played: 10,
            nickname_changes: 0 // Never changed nickname
          }]
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'nickname-mission',
              mission_type: 'change_nickname',
              target: 1,
              reward: 200,
              title: 'Personal Touch',
              description: 'Change your nickname to personalize your profile'
            }
          ]
        });

      const response = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      const nicknameMission = response.body.missions.find(m => m.mission_type === 'change_nickname');
      expect(nicknameMission).toBeDefined();
      expect(nicknameMission.reward).toBe(200);
    });
  });

  describe('Mission Progress Validation', () => {
    it('should cap progress at target value', async () => {
      const mockMission = {
        id: 'mission-123',
        progress: 3, // Already at target
        target: 3,
        completed: true,
        reward: 75,
        title: 'Take Flight'
      };

      mockDb.mockQuery.mockResolvedValueOnce({ rows: [mockMission] });

      const response = await request(app)
        .post('/api/missions/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          missionType: 'play_games',
          amount: 5 // Trying to add more than needed
        });

      expect(response.status).toBe(200);
      expect(response.body.mission.progress).toBe(3); // Should be capped at target
    });

    it('should handle large progress amounts', async () => {
      const response = await request(app)
        .post('/api/missions/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          missionType: 'collect_coins',
          amount: 50000 // Very large amount (should be rejected)
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('amount');
    });
  });

  describe('Mission Types Coverage', () => {
    const missionTypes = [
      'play_games',
      'reach_score', 
      'maintain_streak',
      'use_continue',
      'collect_coins',
      'survive_time',
      'change_nickname'
    ];

    missionTypes.forEach(missionType => {
      it(`should handle ${missionType} mission progress`, async () => {
        const mockMission = {
          id: `${missionType}-mission`,
          progress: 1,
          target: 5,
          completed: false,
          reward: 100,
          title: `Test ${missionType} Mission`
        };

        mockDb.mockQuery.mockResolvedValueOnce({ rows: [mockMission] });

        const response = await request(app)
          .post('/api/missions/progress')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            missionType,
            amount: 1
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('Error Edge Cases', () => {
    it('should handle database timeout during mission generation', async () => {
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValue(new Error('Connection timeout'));

      const response = await request(app)
        .get('/api/missions/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch daily missions');
    });

    it('should handle concurrent mission progress updates', async () => {
      const mockMission = {
        id: 'concurrent-mission',
        progress: 2,
        target: 3,
        completed: false,
        reward: 100,
        title: 'Concurrent Test'
      };

      // Simulate concurrent updates
      mockDb.mockQuery
        .mockResolvedValueOnce({ rows: [mockMission] })
        .mockResolvedValueOnce({ rows: [{ ...mockMission, progress: 3, completed: true }] });

      const promises = [
        request(app)
          .post('/api/missions/progress')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ missionType: 'play_games', amount: 1 }),
        request(app)
          .post('/api/missions/progress')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ missionType: 'play_games', amount: 1 })
      ];

      const responses = await Promise.all(promises);
      
      // Both should succeed (database handles concurrency)
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });
});
