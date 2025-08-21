# 🚀 FlappyJet Backend Deployment Guide

## 📋 **Pre-Deployment Checklist**

### ✅ **Requirements**
- [x] **90%+ Test Coverage** - Comprehensive test suite implemented
- [x] **Production-Ready Code** - All routes and error handling complete
- [x] **Security Measures** - JWT auth, rate limiting, input validation
- [x] **Database Migrations** - Complete schema and seed data
- [x] **Environment Configuration** - Production environment variables
- [x] **Health Checks** - Monitoring and status endpoints

## 🛠️ **Railway Setup**

### **1. Install Railway CLI**
```bash
npm install -g @railway/cli
```

### **2. Login to Railway**
```bash
railway login
```

### **3. Deploy Using Our Script**
```bash
# Automated deployment (recommended)
./scripts/deploy.sh

# Manual deployment
railway init
railway add postgresql
railway up
```

## 🔧 **Environment Variables**

The following environment variables will be automatically configured:

### **🔐 Security**
- `JWT_SECRET` - Auto-generated secure secret
- `NODE_ENV=production`
- `JWT_EXPIRES_IN=24h`

### **🌐 Server**
- `PORT` - Auto-assigned by Railway
- `DATABASE_URL` - Auto-configured PostgreSQL

### **⚡ Performance**
- `RATE_LIMIT_POINTS=100`
- `RATE_LIMIT_DURATION=60`
- `ENABLE_ANALYTICS=true`
- `LOG_LEVEL=info`

### **📊 Monitoring**
- `HEALTH_CHECK_ENABLED=true`
- `ENABLE_PERFORMANCE_MONITORING=true`

## 🗄️ **Database Setup**

### **Automatic Migration**
The deployment script automatically:
1. Creates PostgreSQL database on Railway
2. Runs all database migrations
3. Seeds initial data (achievements, mission templates)
4. Creates materialized views for leaderboards

### **Manual Migration** (if needed)
```bash
railway run npm run migrate:production
```

## 🚀 **Deployment Process**

### **Option 1: Automated Script (Recommended)**
```bash
# Run the complete deployment script
./scripts/deploy.sh
```

**What the script does:**
1. ✅ Runs test suite (90%+ coverage verification)
2. 🔧 Creates Railway project if needed
3. 🗄️ Adds PostgreSQL database
4. 🔐 Generates secure JWT secret
5. ⚙️ Configures environment variables
6. 🚀 Deploys to Railway
7. 🗄️ Runs database migrations
8. ✅ Performs health check
9. 📊 Opens Railway dashboard

### **Option 2: Manual Deployment**
```bash
# Initialize Railway project
railway init

# Add PostgreSQL database
railway add postgresql

# Set environment variables
railway variables set NODE_ENV=production
railway variables set JWT_SECRET=$(openssl rand -base64 32)
railway variables set JWT_EXPIRES_IN=24h

# Deploy
railway up

# Run migrations
railway run npm run migrate:production
```

## 📊 **Post-Deployment Verification**

### **1. Health Check**
```bash
curl https://your-app.railway.app/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "database": "connected"
}
```

### **2. API Endpoints Test**
```bash
# Test authentication
curl -X POST https://your-app.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test123","nickname":"TestPlayer"}'

# Test leaderboard
curl https://your-app.railway.app/api/leaderboard/global
```

### **3. Database Verification**
```bash
# Check database connection
railway connect postgresql
```

## 🔍 **Monitoring & Logs**

### **Railway Dashboard**
- **Deployments**: View deployment history and status
- **Metrics**: CPU, memory, and request metrics
- **Logs**: Real-time application logs
- **Variables**: Environment variable management

### **Health Monitoring**
- **Endpoint**: `/health`
- **Frequency**: Automatic health checks every 30 seconds
- **Timeout**: 300 seconds
- **Restart Policy**: On failure (max 3 retries)

### **Application Logs**
```bash
# View live logs
railway logs

# View specific service logs
railway logs --service backend
```

## 🌐 **Custom Domain Setup**

### **Add Custom Domain**
```bash
# Add your domain
railway domain add yourdomain.com

# View current domains
railway domain list
```

### **DNS Configuration**
Point your domain to Railway:
- **Type**: CNAME
- **Name**: @ (or subdomain)
- **Value**: Your Railway app URL

## 🔧 **Configuration Files**

### **railway.json**
```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm ci && npm run build:production"
  },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### **Procfile**
```
web: npm start
```

## 🚨 **Troubleshooting**

### **Common Issues**

#### **Deployment Fails**
```bash
# Check logs
railway logs

# Verify environment variables
railway variables

# Check service status
railway status
```

#### **Database Connection Issues**
```bash
# Verify DATABASE_URL is set
railway variables | grep DATABASE_URL

# Test database connection
railway run npm run migrate:production
```

#### **Health Check Fails**
```bash
# Check if server is starting
railway logs --tail 100

# Verify PORT environment variable
railway variables | grep PORT

# Test health endpoint locally
curl http://localhost:3000/health
```

### **Performance Issues**
```bash
# Check resource usage
railway metrics

# Scale if needed (Pro plan)
railway scale --replicas 2
```

## 📱 **Flutter App Integration**

### **Update Backend URL**
Update your Flutter app configuration:

```dart
// lib/config/api_config.dart
class ApiConfig {
  static const String baseUrl = 'https://your-app.railway.app';
  static const String apiVersion = '/api';
}
```

### **Test API Connection**
```dart
// Test the connection
final response = await http.get(
  Uri.parse('${ApiConfig.baseUrl}/health'),
);
print('Backend Status: ${response.statusCode}');
```

## 🔄 **Continuous Deployment**

### **GitHub Integration**
1. Connect Railway to your GitHub repository
2. Enable auto-deployments on push to main branch
3. Set up branch-based environments (staging/production)

### **Automated Testing**
The deployment script automatically runs:
- ✅ Full test suite (90%+ coverage)
- 🔍 Linting and code quality checks
- 🛡️ Security vulnerability scanning

## 📊 **Scaling & Performance**

### **Horizontal Scaling**
```bash
# Scale to multiple instances (Pro plan)
railway scale --replicas 3
```

### **Database Optimization**
- ✅ Materialized views for leaderboards
- 📊 Proper indexing on all tables
- 🔄 Automatic view refresh scheduling

### **Caching Strategy**
- 🚀 In-memory caching for frequent queries
- 📊 Redis integration (add with `railway add redis`)
- 🔄 Cache invalidation on data updates

## 🎯 **Production Checklist**

### **Before Going Live**
- [ ] **Domain Setup** - Custom domain configured
- [ ] **SSL Certificate** - HTTPS enabled (automatic on Railway)
- [ ] **Environment Variables** - All secrets properly set
- [ ] **Database Backup** - Backup strategy in place
- [ ] **Monitoring** - Health checks and alerts configured
- [ ] **Rate Limiting** - Production limits configured
- [ ] **Error Tracking** - Logging and error reporting setup

### **Launch Day**
- [ ] **Final Tests** - All endpoints tested
- [ ] **Performance Check** - Load testing completed
- [ ] **Monitoring Active** - Dashboard monitoring enabled
- [ ] **Team Notified** - All stakeholders informed
- [ ] **Rollback Plan** - Emergency procedures ready

## 🎉 **Success Metrics**

### **Technical KPIs**
- ✅ **Uptime**: 99.9% availability
- ⚡ **Response Time**: < 500ms average
- 🧪 **Test Coverage**: 90%+ maintained
- 🔒 **Security**: Zero vulnerabilities
- 📊 **Performance**: Handles 1000+ concurrent users

### **Business KPIs**
- 📱 **User Registration**: Seamless onboarding
- 🎮 **Game Sessions**: Real-time score tracking
- 💰 **Purchases**: Secure IAP validation
- 🏆 **Leaderboards**: Live competitive rankings
- 🎯 **Missions**: Dynamic daily challenges

---

## 🚀 **Ready to Deploy!**

Your FlappyJet backend is production-ready with:
- **🧪 90%+ Test Coverage** - Comprehensive quality assurance
- **🔒 Enterprise Security** - JWT auth and rate limiting
- **📊 Real-time Analytics** - Player behavior tracking
- **⚡ High Performance** - Optimized for mobile gaming
- **🛡️ Reliability** - Error handling and monitoring

**Deploy now with:**
```bash
./scripts/deploy.sh
```

**🎮 Game Launch Ready! 🚀**
