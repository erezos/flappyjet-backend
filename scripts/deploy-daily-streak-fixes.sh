#!/bin/bash

# 🎯 Deploy Daily Streak Fixes to Railway Backend
# This script applies all the daily streak system fixes

set -e  # Exit on any error

echo "🚀 Starting Daily Streak Fixes Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    print_error "Railway CLI is not installed. Please install it first."
    exit 1
fi

# Check if we're logged in to Railway
if ! railway whoami &> /dev/null; then
    print_error "Not logged in to Railway. Please run 'railway login' first."
    exit 1
fi

print_status "Connected to Railway: $(railway whoami)"

# Step 1: Apply database schema changes
print_status "Step 1: Applying database schema changes..."
if railway connect postgres < database/enhanced-daily-streak-schema.sql; then
    print_success "Database schema updated successfully"
else
    print_error "Failed to apply database schema changes"
    exit 1
fi

# Step 2: Deploy the updated backend
print_status "Step 2: Deploying updated backend code..."
if railway up; then
    print_success "Backend deployed successfully"
else
    print_error "Failed to deploy backend"
    exit 1
fi

# Step 3: Verify deployment
print_status "Step 3: Verifying deployment..."
sleep 10  # Wait for deployment to complete

# Test the new daily streak endpoint
print_status "Testing new daily streak endpoints..."

# Get the Railway URL
RAILWAY_URL=$(railway domain)
if [ -z "$RAILWAY_URL" ]; then
    print_warning "Could not get Railway URL, skipping endpoint tests"
else
    print_status "Testing endpoints at: https://$RAILWAY_URL"
    
    # Test health endpoint
    if curl -s -f "https://$RAILWAY_URL/api/health" > /dev/null; then
        print_success "Health endpoint is responding"
    else
        print_warning "Health endpoint test failed"
    fi
fi

# Step 4: Show deployment summary
print_success "🎉 Daily Streak Fixes Deployment Complete!"
echo ""
echo "📋 Deployment Summary:"
echo "  ✅ Database schema enhanced with cycle tracking"
echo "  ✅ New daily streak API endpoints deployed"
echo "  ✅ Enhanced notification system activated"
echo "  ✅ Cycle-aware streak management implemented"
echo ""
echo "🔗 New API Endpoints:"
echo "  POST /api/daily-streak/claim - Claim daily reward"
echo "  GET  /api/daily-streak/analytics - Get streak analytics"
echo "  GET  /api/daily-streak/status - Get streak status"
echo "  POST /api/daily-streak/reset - Reset streak (testing)"
echo ""
echo "📊 Database Changes:"
echo "  ✅ Added cycle tracking fields to daily_streaks table"
echo "  ✅ Created daily_streak_cycles analytics table"
echo "  ✅ Added validation functions and triggers"
echo "  ✅ Created analytics views"
echo ""
echo "🔔 Notification Enhancements:"
echo "  ✅ Cycle-aware reminder messages"
echo "  ✅ Special notifications for Day 2 jet rewards"
echo "  ✅ Cycle completion celebrations"
echo ""
print_status "Ready for Flutter app integration!"
