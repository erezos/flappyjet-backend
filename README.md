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
