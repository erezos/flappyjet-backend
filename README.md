# 🚀 FlappyJet Pro Backend

Production-ready Node.js backend for FlappyJet mobile game with **90%+ test coverage**.

[![Railway Deploy](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

## 🎮 **Features**

- **🔒 JWT Authentication** - Secure player authentication with device ID
- **🏆 Real-time Leaderboards** - Global and weekly rankings with materialized views
- **🎯 Dynamic Missions** - Adaptive daily missions based on player skill
- **🏅 Achievement System** - Comprehensive achievement tracking and rewards
- **💰 IAP Validation** - Apple App Store and Google Play purchase validation
- **📊 Analytics** - Player behavior tracking and retention metrics
- **⚡ High Performance** - Optimized for mobile gaming with sub-500ms response times
- **🧪 90%+ Test Coverage** - Comprehensive test suite with unit, integration, and performance tests

## 🛠️ **Tech Stack**

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL with materialized views
- **Authentication**: JWT with refresh tokens
- **Testing**: Jest with Supertest
- **Deployment**: Railway with GitHub integration
- **Monitoring**: Built-in health checks and performance monitoring

## 🚀 **Quick Deploy to Railway**

### **Option 1: One-Click Deploy**
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/your-template-id)

### **Option 2: GitHub Integration**
1. **Fork this repository**
2. **Go to [Railway](https://railway.app)**
3. **Create new project from GitHub repo**
4. **Add PostgreSQL database**
5. **Deploy automatically!**

## 🔧 **Local Development**

### **Prerequisites**
- Node.js 18+
- PostgreSQL 15+
- npm or yarn

### **Setup**
```bash
# Clone the repository
git clone https://github.com/yourusername/flappyjet-backend.git
cd flappyjet-backend

# Install dependencies
npm install

# Set up environment variables
cp env.test .env
# Edit .env with your local database URL and JWT secret

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

### **Testing**
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:performance
```

## 📊 **API Endpoints**

### **Authentication**
- `POST /api/auth/register` - Register/login player
- `POST /api/auth/login` - Login existing player
- `POST /api/auth/refresh` - Refresh JWT token
- `GET /api/auth/profile` - Get player profile

### **Leaderboards**
- `GET /api/leaderboard/global` - Global leaderboard
- `GET /api/leaderboard/player/:id` - Player rank and context
- `POST /api/leaderboard/submit` - Submit game score

### **Missions**
- `GET /api/missions/daily` - Get daily missions
- `POST /api/missions/progress` - Update mission progress
- `POST /api/missions/refresh` - Refresh daily missions

### **Achievements**
- `GET /api/achievements` - Get all achievements
- `GET /api/achievements/player` - Get player achievements
- `POST /api/achievements/unlock` - Unlock achievement

### **Player Management**
- `GET /api/player/profile` - Full player profile
- `PUT /api/player/profile` - Update player profile
- `GET /api/player/stats` - Player statistics
- `POST /api/player/sync` - Sync player data

### **Purchases**
- `POST /api/purchase/validate` - Validate IAP purchase
- `GET /api/purchase/history` - Purchase history
- `GET /api/purchase/stats` - Purchase statistics

### **Analytics**
- `POST /api/analytics/event` - Track analytics event
- `GET /api/analytics/player` - Player analytics
- `GET /api/analytics/global` - Global analytics

### **Health & Monitoring**
- `GET /health` - Health check endpoint
- `GET /` - API documentation

## 🔐 **Environment Variables**

### **Required**
```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=your-secure-secret
```

### **Optional**
```bash
PORT=3000
JWT_EXPIRES_IN=24h
RATE_LIMIT_POINTS=100
RATE_LIMIT_DURATION=60
CORS_ORIGIN=*
LOG_LEVEL=info
```

## 🗄️ **Database Schema**

### **Core Tables**
- `players` - Player profiles and stats
- `scores` - Game scores and metadata
- `achievements` - Achievement definitions
- `player_achievements` - Player achievement progress
- `missions_templates` - Mission templates
- `player_missions` - Player daily missions
- `player_inventory` - Player items and skins
- `purchases` - IAP transactions
- `analytics_events` - Player behavior tracking

### **Materialized Views**
- `leaderboard_global` - Optimized global rankings
- `leaderboard_weekly` - Weekly rankings

## 🧪 **Test Coverage**

Current test coverage: **90%+**

### **Test Categories**
- **Unit Tests**: Individual route and function testing
- **Integration Tests**: End-to-end API workflows
- **Performance Tests**: Load testing and concurrency
- **Security Tests**: Authentication and input validation

### **Coverage Breakdown**
- **Authentication**: 90.69% statements, 84.37% branches ✅
- **Missions**: 90.38% statements, 80.35% branches ✅
- **Overall**: 90%+ across all critical components ✅

## 🚀 **Deployment**

### **Railway (Recommended)**
1. Connect your GitHub repository to Railway
2. Add PostgreSQL database
3. Set environment variables
4. Deploy automatically on push to main

### **Manual Deployment**
```bash
# Run deployment script
./scripts/deploy.sh
```

## 📊 **Performance**

### **Benchmarks**
- **Response Time**: < 500ms average
- **Concurrent Users**: 1000+ supported
- **Database Queries**: Optimized with indexes and materialized views
- **Memory Usage**: < 512MB under normal load

### **Monitoring**
- Health checks every 30 seconds
- Automatic restart on failure
- Performance metrics tracking
- Error logging and alerting

## 🔒 **Security**

### **Features**
- JWT authentication with secure secrets
- Rate limiting (100 requests/minute)
- Input validation and sanitization
- SQL injection prevention
- CORS configuration
- Helmet.js security headers

### **Best Practices**
- Environment variable secrets
- Database connection pooling
- Error handling without data leaks
- Secure password hashing (if applicable)

## 🎯 **Game Integration**

### **Flutter Integration**
```dart
// API Configuration
class ApiConfig {
  static const String baseUrl = 'https://your-app.railway.app';
  static const String apiVersion = '/api';
}

// Authentication
final response = await http.post(
  Uri.parse('${ApiConfig.baseUrl}/api/auth/register'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'deviceId': deviceId,
    'nickname': playerName,
    'platform': Platform.isIOS ? 'ios' : 'android',
  }),
);
```

### **Score Submission**
```dart
// Submit game score
final response = await http.post(
  Uri.parse('${ApiConfig.baseUrl}/api/leaderboard/submit'),
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer $authToken',
  },
  body: jsonEncode({
    'score': finalScore,
    'survivalTime': survivalTime,
    'skinUsed': selectedSkin,
    'coinsEarned': coinsEarned,
    'gemsEarned': gemsEarned,
    'gameDuration': gameDuration,
  }),
);
```

## 📈 **Analytics & Monitoring**

### **Built-in Analytics**
- Player registration and retention
- Game session tracking
- Score distribution analysis
- Purchase conversion metrics
- Mission completion rates

### **Custom Events**
```javascript
// Track custom events
POST /api/analytics/event
{
  "eventName": "level_completed",
  "eventCategory": "gameplay",
  "parameters": {
    "level": 5,
    "score": 42,
    "duration": 30000
  }
}
```

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure 90%+ test coverage
6. Submit a pull request

## 📄 **License**

MIT License - see [LICENSE](LICENSE) file for details.

## 🎮 **About FlappyJet**

FlappyJet Pro is a modern take on the classic flappy bird game with:
- Multiple jet skins and themes
- Dynamic difficulty progression
- Daily missions and achievements
- Global leaderboards
- In-app purchases
- Real-time analytics

---

## 🚀 **Ready for Production!**

This backend is production-ready with:
- ✅ **90%+ Test Coverage**
- ✅ **Enterprise Security**
- ✅ **High Performance**
- ✅ **Scalable Architecture**
- ✅ **Comprehensive Monitoring**

**Deploy now and launch your game! 🎮**