#!/bin/bash

# ============================================================================
# Push Notifications Migration Script
# Applies 010_push_notifications_schema.sql to Railway PostgreSQL
# ============================================================================

echo "🚀 Starting Push Notifications Schema Migration..."
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable not set"
    echo "Please set it from Railway dashboard:"
    echo "railway variables"
    echo ""
    echo "Or run locally with:"
    echo "export DATABASE_URL='your_postgres_url'"
    exit 1
fi

# Run the migration
echo "📊 Applying migration 010_push_notifications_schema.sql..."
psql "$DATABASE_URL" -f railway-backend/database/migrations/010_push_notifications_schema.sql

# Check if successful
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed successfully!"
    echo ""
    echo "📋 Verifying tables..."
    psql "$DATABASE_URL" -c "\dt fcm_tokens" -c "\dt notification_events" -c "\dt notification_preferences"
    echo ""
    echo "🎉 Push notification system ready!"
else
    echo ""
    echo "❌ Migration failed!"
    echo "Please check the error messages above."
    exit 1
fi

