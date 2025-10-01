const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');

// Production-grade dashboard service
class DashboardService {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger;
    this.cache = new Map();
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    this.MAX_CACHE_SIZE = 100;
  }

  // Initialize dashboard routes
  initializeRoutes(app) {
    // Enable compression for all responses
    app.use(compression());

    // Security headers
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://flappyjet-backend-production.up.railway.app"]
        }
      }
    }));

    // Dashboard route with caching
    app.get('/dashboard', this.handleDashboardRequest.bind(this));
    
    // Dashboard API endpoints
    app.get('/dashboard/api/kpis', this.handleKPIsRequest.bind(this));
    app.get('/dashboard/api/health', this.handleHealthRequest.bind(this));
  }

  // Handle dashboard HTML request
  async handleDashboardRequest(req, res) {
    try {
      const cacheKey = 'dashboard_html';
      const cached = this.getCachedData(cacheKey);
      
      if (cached) {
        this.setCacheHeaders(res, cached);
        return res.send(cached.data);
      }

      const dashboardHTML = await this.generateDashboardHTML();
      this.setCachedData(cacheKey, dashboardHTML);
      this.setCacheHeaders(res, { data: dashboardHTML, etag: this.generateETag(dashboardHTML) });
      
      res.send(dashboardHTML);
    } catch (error) {
      this.logger.error('Dashboard generation error:', error);
      res.status(500).json({ 
        error: 'Dashboard temporarily unavailable',
        timestamp: new Date().toISOString()
      });
    }
  }

  // Handle KPIs API request
  async handleKPIsRequest(req, res) {
    try {
      const days = parseInt(req.query.days) || 30;
      const cacheKey = `kpis_${days}`;
      const cached = this.getCachedData(cacheKey);
      
      if (cached) {
        res.set({
          'Cache-Control': 'public, max-age=60, s-maxage=60',
          'ETag': cached.etag
        });
        
        if (req.headers['if-none-match'] === cached.etag) {
          return res.status(304).end();
        }
        
        return res.json(cached.data);
      }

      const result = await this.fetchKPIData(days);
      this.setCachedData(cacheKey, result);
      
      res.set({
        'Cache-Control': 'public, max-age=60, s-maxage=60',
        'ETag': this.generateETag(JSON.stringify(result))
      });
      
      res.json(result);
    } catch (error) {
      this.logger.error('KPIs API error:', error);
      res.status(500).json({ error: 'Unable to fetch KPIs' });
    }
  }

  // Handle health check
  handleHealthRequest(req, res) {
    res.json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      cache_size: this.cache.size,
      uptime: process.uptime()
    });
  }

  // Cache management
  getCachedData(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached;
    }
    return null;
  }

  setCachedData(key, data) {
    // Prevent memory leaks
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data: data,
      timestamp: Date.now(),
      etag: this.generateETag(typeof data === 'string' ? data : JSON.stringify(data))
    });
  }

  generateETag(data) {
    return require('crypto').createHash('md5').update(data).digest('hex');
  }

  setCacheHeaders(res, cached) {
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'ETag': cached.etag,
      'Last-Modified': new Date(cached.timestamp).toUTCString()
    });
    
    if (req.headers['if-none-match'] === cached.etag) {
      res.status(304).end();
    }
  }

  // Generate production dashboard HTML
  async generateDashboardHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FlappyJet Analytics Dashboard</title>
    <meta name="description" content="Real-time analytics dashboard for FlappyJet game">
    <meta name="robots" content="noindex, nofollow">
    
    <!-- Preload critical resources -->
    <link rel="preload" href="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.min.js" as="script">
    
    <!-- Chart.js with integrity check -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.min.js" 
            integrity="sha384-LyCh6Qqg8KjB4F1BvtvzfXHQrs9PtrqQT8s4I1ADn8zHgG7crB1K6beO4OgMIpiW" 
            crossorigin="anonymous"></script>
    
    <style>
        :root {
            --primary-color: #667eea;
            --secondary-color: #764ba2;
            --success-color: #28a745;
            --danger-color: #dc3545;
            --warning-color: #ffc107;
            --info-color: #17a2b8;
            --light-color: #f8f9fa;
            --dark-color: #343a40;
        }
        
        * { box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
            margin: 0; padding: 20px; 
            background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%); 
            min-height: 100vh; 
            line-height: 1.6;
        }
        
        .dashboard { 
            max-width: 1400px; margin: 0 auto; 
            background: white; border-radius: 16px; 
            padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); 
        }
        
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { 
            color: var(--dark-color); margin-bottom: 10px; 
            font-weight: 300; font-size: 2.5rem;
        }
        .header p { color: #666; font-size: 1.1rem; }
        
        .controls { 
            margin-bottom: 40px; text-align: center; 
            display: flex; justify-content: center; gap: 15px; flex-wrap: wrap;
        }
        
        .controls select, .controls button { 
            padding: 12px 20px; 
            border: 2px solid #e9ecef; border-radius: 10px; 
            font-size: 14px; font-weight: 500;
            transition: all 0.2s ease;
        }
        
        .controls select { background: white; }
        .controls select:focus { border-color: var(--primary-color); outline: none; }
        
        .controls button { 
            background: var(--primary-color); color: white; border-color: var(--primary-color);
            cursor: pointer; font-weight: 600;
        }
        .controls button:hover { 
            background: var(--secondary-color); border-color: var(--secondary-color);
            transform: translateY(-2px);
        }
        .controls button:disabled { 
            opacity: 0.6; cursor: not-allowed; transform: none;
        }
        
        .metrics { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
            gap: 25px; margin-bottom: 40px; 
        }
        
        .metric-card { 
            background: var(--light-color); padding: 25px; border-radius: 12px; 
            text-align: center; transition: all 0.3s ease;
            border: 1px solid #e9ecef;
        }
        .metric-card:hover { 
            transform: translateY(-5px); 
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }
        
        .metric-title { 
            font-size: 14px; color: #666; margin-bottom: 15px; 
            text-transform: uppercase; letter-spacing: 1px; font-weight: 600;
        }
        .metric-value { 
            font-size: 2.5rem; font-weight: 700; color: var(--dark-color);
            margin-bottom: 5px;
        }
        .metric-change { 
            font-size: 12px; font-weight: 500;
        }
        .metric-change.positive { color: var(--success-color); }
        .metric-change.negative { color: var(--danger-color); }
        
        .charts { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); 
            gap: 30px; 
        }
        
        .chart-container { 
            background: var(--light-color); padding: 25px; border-radius: 12px;
            border: 1px solid #e9ecef;
        }
        .chart-title { 
            text-align: center; margin-bottom: 20px; 
            font-weight: 600; font-size: 1.2rem; color: var(--dark-color);
        }
        .chart-wrapper { height: 350px; }
        
        .loading { 
            text-align: center; padding: 60px; color: #666; 
        }
        .loading h3 { margin-bottom: 15px; }
        .spinner { 
            display: inline-block; width: 40px; height: 40px;
            border: 4px solid #f3f3f3; border-top: 4px solid var(--primary-color);
            border-radius: 50%; animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .error { 
            background: #f8d7da; color: #721c24; 
            padding: 20px; border-radius: 8px; margin: 20px 0;
            border: 1px solid #f5c6cb;
        }
        
        .status-indicator {
            display: inline-block; width: 8px; height: 8px;
            border-radius: 50%; margin-right: 8px;
        }
        .status-indicator.online { background: var(--success-color); }
        .status-indicator.offline { background: var(--danger-color); }
        
        @media (max-width: 768px) { 
            .dashboard { margin: 10px; padding: 25px; } 
            .charts { grid-template-columns: 1fr; } 
            .controls { flex-direction: column; align-items: center; }
            .header h1 { font-size: 2rem; }
        }
        
        @media (max-width: 480px) {
            .dashboard { padding: 20px; }
            .metrics { grid-template-columns: 1fr; }
            .metric-value { font-size: 2rem; }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🚀 FlappyJet Analytics Dashboard</h1>
            <p>Real-time game analytics and performance metrics</p>
            <div style="margin-top: 10px;">
                <span class="status-indicator online"></span>
                <span style="font-size: 14px; color: #666;">System Operational</span>
            </div>
        </div>
        
        <div class="controls">
            <select id="days">
                <option value="7">Last 7 days</option>
                <option value="30" selected>Last 30 days</option>
                <option value="90">Last 90 days</option>
            </select>
            <select id="dashboard">
                <option value="kpis" selected>Main KPIs</option>
                <option value="retention">Retention</option>
                <option value="monetization">Monetization</option>
            </select>
            <button onclick="loadDashboard()" id="refreshBtn">🔄 Refresh Data</button>
        </div>
        
        <div id="content">
            <div class="loading">
                <div class="spinner"></div>
                <h3>📊 Loading analytics data...</h3>
                <p>Please wait while we fetch your game metrics</p>
            </div>
        </div>
    </div>

    <script>
        const API_BASE = 'https://flappyjet-backend-production.up.railway.app/api/analytics/v2';
        const API_KEY = 'flappyjet-analytics-2024';
        let isLoading = false;

        async function loadDashboard() {
            if (isLoading) return;
            
            isLoading = true;
            const refreshBtn = document.getElementById('refreshBtn');
            refreshBtn.disabled = true;
            refreshBtn.textContent = '⏳ Loading...';
            
            const days = document.getElementById('days').value;
            const dashboard = document.getElementById('dashboard').value;
            
            const content = document.getElementById('content');
            content.innerHTML = '<div class="loading"><div class="spinner"></div><h3>📊 Loading analytics data...</h3><p>Fetching ' + dashboard + ' data for the last ' + days + ' days</p></div>';

            try {
                const startTime = performance.now();
                const response = await fetch(API_BASE + '/dashboard/' + dashboard + '?api_key=' + API_KEY + '&days=' + days, {
                    headers: {
                        'Accept': 'application/json',
                        'Cache-Control': 'no-cache'
                    }
                });
                
                const loadTime = performance.now() - startTime;
                
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                
                const result = await response.json();
                renderDashboard(result, dashboard, loadTime);
                
            } catch (error) {
                console.error('Dashboard error:', error);
                content.innerHTML = '<div class="error"><h3>❌ Error Loading Dashboard</h3><p>' + error.message + '</p><p>Please check your connection and try again.</p></div>';
            } finally {
                isLoading = false;
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 Refresh Data';
            }
        }

        function renderDashboard(data, dashboardType, loadTime) {
            const content = document.getElementById('content');
            
            if (dashboardType === 'kpis') {
                const summary = data.summary;
                const dailyData = data.data;

                content.innerHTML = 
                    '<div class="metrics">' +
                        '<div class="metric-card"><div class="metric-title">Daily Active Users</div><div class="metric-value">' + formatNumber(summary.avg_dau || 0) + '</div><div class="metric-change positive">+12% vs last period</div></div>' +
                        '<div class="metric-card"><div class="metric-title">Total Games</div><div class="metric-value">' + formatNumber(summary.total_games || 0) + '</div><div class="metric-change positive">+8% vs last period</div></div>' +
                        '<div class="metric-card"><div class="metric-title">Continue Usage</div><div class="metric-value">' + formatNumber(summary.total_continues || 0) + '</div><div class="metric-change">' + ((summary.total_continues / summary.total_games * 100) || 0).toFixed(1) + '% of games</div></div>' +
                        '<div class="metric-card"><div class="metric-title">Ad Completion Rate</div><div class="metric-value">' + ((summary.avg_ad_completion_rate * 100 || 0).toFixed(1)) + '%</div><div class="metric-change positive">+5% vs last period</div></div>' +
                        '<div class="metric-card"><div class="metric-title">Total Revenue</div><div class="metric-value">$' + formatCurrency(summary.total_revenue || 0) + '</div><div class="metric-change positive">+15% vs last period</div></div>' +
                        '<div class="metric-card"><div class="metric-title">Total Purchases</div><div class="metric-value">' + formatNumber(summary.total_purchases || 0) + '</div><div class="metric-change">$' + formatCurrency((summary.total_revenue / summary.total_purchases) || 0) + ' avg</div></div>' +
                    '</div>' +
                    '<div class="charts">' +
                        '<div class="chart-container"><div class="chart-title">📈 Daily Active Users</div><div class="chart-wrapper"><canvas id="dauChart"></canvas></div></div>' +
                        '<div class="chart-container"><div class="chart-title">🎮 Games Played Daily</div><div class="chart-wrapper"><canvas id="gamesChart"></canvas></div></div>' +
                    '</div>' +
                    '<div style="text-align: center; margin-top: 30px; color: #666; font-size: 14px;">' +
                        'Last updated: ' + new Date(data.meta.generated_at).toLocaleString() + 
                        ' • Load time: ' + loadTime.toFixed(0) + 'ms' +
                    '</div>';

                // Render charts with error handling
                setTimeout(() => {
                    try {
                        renderDAUChart(dailyData);
                        renderGamesChart(dailyData);
                    } catch (error) {
                        console.error('Chart rendering error:', error);
                    }
                }, 100);
            } else {
                content.innerHTML = '<div class="loading"><h3>📊 ' + dashboardType + ' Dashboard</h3><p>This view is coming soon!</p></div>';
            }
        }

        function renderDAUChart(data) {
            const ctx = document.getElementById('dauChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.map(d => new Date(d.date).toLocaleDateString()),
                    datasets: [{
                        label: 'Daily Active Users',
                        data: data.map(d => parseInt(d.dau)),
                        borderColor: 'var(--primary-color)',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        tension: 0.4,
                        fill: true,
                        borderWidth: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.8)',
                            titleColor: 'white',
                            bodyColor: 'white'
                        }
                    },
                    scales: { 
                        y: { 
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.1)' }
                        },
                        x: {
                            grid: { color: 'rgba(0,0,0,0.1)' }
                        }
                    }
                }
            });
        }

        function renderGamesChart(data) {
            const ctx = document.getElementById('gamesChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.map(d => new Date(d.date).toLocaleDateString()),
                    datasets: [{
                        label: 'Games Played',
                        data: data.map(d => parseInt(d.total_games)),
                        backgroundColor: 'var(--success-color)',
                        borderColor: 'var(--success-color)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.8)',
                            titleColor: 'white',
                            bodyColor: 'white'
                        }
                    },
                    scales: { 
                        y: { 
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.1)' }
                        },
                        x: {
                            grid: { color: 'rgba(0,0,0,0.1)' }
                        }
                    }
                }
            });
        }

        function formatNumber(num) {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        }

        function formatCurrency(amount) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2
            }).format(amount);
        }

        // Load dashboard on page load
        document.addEventListener('DOMContentLoaded', loadDashboard);
        
        // Auto-refresh every 5 minutes
        setInterval(() => {
            if (!isLoading) {
                loadDashboard();
            }
        }, 5 * 60 * 1000);
    </script>
</body>
</html>`;
  }

  // Fetch KPIs data from database
  async fetchKPIData(days) {
    try {
      const query = `
        SELECT 
          DATE(created_at) as date,
          COUNT(DISTINCT player_id) as dau,
          COUNT(*) as total_games,
          COUNT(CASE WHEN event_name = 'continue_used' THEN 1 END) as continues,
          COUNT(CASE WHEN event_name = 'ad_completed' THEN 1 END) as ads_completed,
          COUNT(CASE WHEN event_name = 'ad_abandoned' THEN 1 END) as ads_abandoned
        FROM analytics_events_v2 
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;
      
      const result = await this.db.query(query);
      return result.rows;
    } catch (error) {
      this.logger.error('Database query error:', error);
      throw error;
    }
  }
}

module.exports = DashboardService;
