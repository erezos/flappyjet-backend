/**
 * 🌐 WebSocket Manager for Real-Time Leaderboard Updates
 * Handles real-time communication for live leaderboard updates
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class WebSocketManager {
  constructor(server, leaderboardService) {
    this.server = server;
    this.leaderboardService = leaderboardService;
    this.wss = null;
    this.clients = new Map(); // clientId -> { ws, userId, subscriptions }
    this.rooms = new Map(); // roomId -> Set of clientIds
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0
    };
    
    this.initialize();
  }

  initialize() {
    logger.info('🌐 Initializing WebSocket Manager...');
    
    this.wss = new WebSocket.Server({
      server: this.server,
      path: '/ws/leaderboard',
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleError.bind(this));

    // Cleanup interval for stale connections
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 30000); // Every 30 seconds

    logger.info('🌐 ✅ WebSocket Manager initialized');
  }

  /**
   * Verify client authentication during WebSocket handshake
   */
  verifyClient(info) {
    try {
      const url = new URL(info.req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      
      if (!token) {
        logger.info('🌐 ❌ WebSocket connection rejected: No token provided');
        return false;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      info.req.user = decoded;
      return true;
    } catch (error) {
      logger.info('🌐 ❌ WebSocket connection rejected: Invalid token');
      return false;
    }
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, req) {
    const clientId = uuidv4();
    const userId = req.user.userId || req.user.id;
    
    logger.info(`🌐 ✅ New WebSocket connection: ${clientId} (User: ${userId})`);
    
    // Store client information
    this.clients.set(clientId, {
      ws,
      userId,
      clientId,
      subscriptions: new Set(),
      lastPing: Date.now(),
      connectedAt: new Date().toISOString()
    });

    // Update statistics
    this.stats.totalConnections++;
    this.stats.activeConnections++;

    // Set up client event handlers
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', () => this.handleDisconnection(clientId));
    ws.on('error', (error) => this.handleClientError(clientId, error));
    ws.on('pong', () => this.handlePong(clientId));

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'welcome',
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Connected to FlappyJet Real-Time Leaderboard'
    });

    // Start ping interval for this client
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  }

  /**
   * Handle incoming messages from clients
   */
  handleMessage(clientId, data) {
    try {
      const client = this.clients.get(clientId);
      if (!client) return;

      this.stats.messagesReceived++;
      
      const message = JSON.parse(data.toString());
      logger.info(`🌐 📨 Message from ${clientId}:`, message.type);

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(clientId, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message);
          break;
        case 'ping':
          this.handleClientPing(clientId);
          break;
        case 'get_leaderboard':
          this.handleGetLeaderboard(clientId, message);
          break;
        case 'get_player_rank':
          this.handleGetPlayerRank(clientId, message);
          break;
        default:
          this.sendToClient(clientId, {
            type: 'error',
            error: `Unknown message type: ${message.type}`
          });
      }
    } catch (error) {
      logger.error(`🌐 ❌ Error handling message from ${clientId}:`, error);
      this.stats.errors++;
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Invalid message format'
      });
    }
  }

  /**
   * Handle client subscription to leaderboard updates
   */
  handleSubscribe(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { room, period = 'all_time' } = message;
    const roomId = `leaderboard:${room}:${period}`;
    
    // Add client to room
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(clientId);
    client.subscriptions.add(roomId);

    logger.info(`🌐 📡 Client ${clientId} subscribed to ${roomId}`);

    this.sendToClient(clientId, {
      type: 'subscribed',
      room: roomId,
      timestamp: new Date().toISOString()
    });

    // Send initial leaderboard data
    this.sendInitialLeaderboardData(clientId, room, period);
  }

  /**
   * Handle client unsubscription
   */
  handleUnsubscribe(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { room, period = 'all_time' } = message;
    const roomId = `leaderboard:${room}:${period}`;
    
    // Remove client from room
    if (this.rooms.has(roomId)) {
      this.rooms.get(roomId).delete(clientId);
      if (this.rooms.get(roomId).size === 0) {
        this.rooms.delete(roomId);
      }
    }
    client.subscriptions.delete(roomId);

    logger.info(`🌐 📡 Client ${clientId} unsubscribed from ${roomId}`);

    this.sendToClient(clientId, {
      type: 'unsubscribed',
      room: roomId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle client ping
   */
  handleClientPing(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastPing = Date.now();
      this.sendToClient(clientId, {
        type: 'pong',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle pong response from client
   */
  handlePong(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastPing = Date.now();
    }
  }

  /**
   * Handle real-time leaderboard request
   */
  async handleGetLeaderboard(clientId, message) {
    try {
      const { period = 'all_time', limit = 10, offset = 0 } = message;
      
      const result = await this.leaderboardService.getGlobalLeaderboard({
        period,
        limit,
        offset,
        includeStats: true
      });

      this.sendToClient(clientId, {
        type: 'leaderboard_data',
        data: result,
        requestId: message.requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`🌐 ❌ Error fetching leaderboard for ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Failed to fetch leaderboard data',
        requestId: message.requestId
      });
    }
  }

  /**
   * Handle real-time player rank request
   */
  async handleGetPlayerRank(clientId, message) {
    try {
      const client = this.clients.get(clientId);
      if (!client) return;

      const { playerId = client.userId, period = 'all_time' } = message;
      
      const result = await this.leaderboardService.getPlayerContext(playerId, period);

      this.sendToClient(clientId, {
        type: 'player_rank_data',
        data: result,
        requestId: message.requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`🌐 ❌ Error fetching player rank for ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        error: 'Failed to fetch player rank data',
        requestId: message.requestId
      });
    }
  }

  /**
   * Send initial leaderboard data to newly subscribed client
   */
  async sendInitialLeaderboardData(clientId, room, period) {
    try {
      const result = await this.leaderboardService.getGlobalLeaderboard({
        period,
        limit: 100,
        offset: 0,
        includeStats: true
      });

      this.sendToClient(clientId, {
        type: 'initial_leaderboard',
        room,
        period,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`🌐 ❌ Error sending initial leaderboard data to ${clientId}:`, error);
    }
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(clientId) {
    logger.info(`🌐 ❌ Client disconnected: ${clientId}`);
    
    const client = this.clients.get(clientId);
    if (client) {
      // Remove client from all rooms
      client.subscriptions.forEach(roomId => {
        if (this.rooms.has(roomId)) {
          this.rooms.get(roomId).delete(clientId);
          if (this.rooms.get(roomId).size === 0) {
            this.rooms.delete(roomId);
          }
        }
      });
      
      this.clients.delete(clientId);
      this.stats.activeConnections--;
    }
  }

  /**
   * Handle client errors
   */
  handleClientError(clientId, error) {
    logger.error(`🌐 ❌ Client error for ${clientId}:`, error);
    this.stats.errors++;
  }

  /**
   * Handle WebSocket server errors
   */
  handleError(error) {
    logger.error('🌐 ❌ WebSocket Server error:', error);
    this.stats.errors++;
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
        this.stats.messagesSent++;
        return true;
      } catch (error) {
        logger.error(`🌐 ❌ Error sending message to ${clientId}:`, error);
        this.stats.errors++;
        return false;
      }
    }
    return false;
  }

  /**
   * Broadcast message to all clients in a room
   */
  broadcastToRoom(roomId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    let sentCount = 0;
    room.forEach(clientId => {
      if (this.sendToClient(clientId, message)) {
        sentCount++;
      }
    });

    logger.info(`🌐 📡 Broadcasted to ${sentCount}/${room.size} clients in ${roomId}`);
    return sentCount;
  }

  /**
   * Broadcast leaderboard update to all subscribed clients
   */
  broadcastLeaderboardUpdate(period = 'all_time', updateData) {
    const roomId = `leaderboard:global:${period}`;
    
    this.broadcastToRoom(roomId, {
      type: 'leaderboard_update',
      period,
      data: updateData,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Broadcast new score notification
   */
  broadcastNewScore(scoreData) {
    // Broadcast to all global leaderboard rooms
    ['all_time', 'daily', 'weekly', 'monthly'].forEach(period => {
      const roomId = `leaderboard:global:${period}`;
      
      this.broadcastToRoom(roomId, {
        type: 'new_score',
        period,
        data: {
          playerId: scoreData.playerId,
          nickname: scoreData.nickname,
          score: scoreData.score,
          rank: scoreData.rank,
          isPersonalBest: scoreData.isPersonalBest
        },
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Broadcast rank change notification
   */
  broadcastRankChange(playerId, oldRank, newRank, period = 'all_time') {
    const roomId = `leaderboard:global:${period}`;
    
    this.broadcastToRoom(roomId, {
      type: 'rank_change',
      period,
      data: {
        playerId,
        oldRank,
        newRank,
        change: oldRank - newRank
      },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections() {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    this.clients.forEach((client, clientId) => {
      if (now - client.lastPing > staleThreshold) {
        logger.info(`🌐 🧹 Cleaning up stale connection: ${clientId}`);
        client.ws.terminate();
        this.handleDisconnection(clientId);
      }
    });
  }

  /**
   * Get WebSocket statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeRooms: this.rooms.size,
      roomDetails: Array.from(this.rooms.entries()).map(([roomId, clients]) => ({
        roomId,
        clientCount: clients.size
      }))
    };
  }

  /**
   * Get connected clients info
   */
  getClients() {
    return Array.from(this.clients.entries()).map(([clientId, client]) => ({
      clientId,
      userId: client.userId,
      subscriptions: Array.from(client.subscriptions),
      connectedAt: client.connectedAt,
      lastPing: new Date(client.lastPing).toISOString()
    }));
  }

  /**
   * Send notification to a specific player
   */
  notifyPlayer(playerId, message) {
    try {
      // Check if player has any active connections
      const hasActiveConnections = Array.from(this.clients.values()).some(c => c.userId === playerId);
      
      if (!hasActiveConnections) {
        logger.info(`🌐 📤 No active connections for player ${playerId}`);
        return;
      }

      const messageData = {
        type: 'player_notification',
        ...message,
        timestamp: new Date().toISOString()
      };

      let successCount = 0;
      this.clients.forEach((client, clientId) => {
        if (client.userId === playerId && this.sendToClient(clientId, messageData)) {
          successCount++;
        }
      });

      const totalPlayerConnections = Array.from(this.clients.values()).filter(c => c.userId === playerId).length;
      logger.info(`🌐 📤 Notified player ${playerId}: ${successCount}/${totalPlayerConnections} connections`);
    } catch (error) {
      logger.error(`🌐 ❌ Error in notifyPlayer:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown() {
    logger.info('🌐 🛑 Shutting down WebSocket Manager...');
    
    // Close all client connections
    this.clients.forEach((client, clientId) => {
      client.ws.close(1000, 'Server shutting down');
    });
    
    // Close WebSocket server
    if (this.wss) {
      this.wss.close(() => {
        logger.info('🌐 ✅ WebSocket Manager shutdown complete');
      });
    }
  }
}

module.exports = { WebSocketManager };
