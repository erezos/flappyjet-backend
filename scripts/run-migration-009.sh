#!/bin/bash
# ============================================================================
# Run Migration 009: Add Monetization Event Types
# ============================================================================

set -e  # Exit on error

echo "🔧 Running migration 009: Add monetization event types..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  echo "💡 Get it from Railway: Settings > Variables > DATABASE_URL"
  exit 1
fi

echo "📊 Database URL found (first 50 chars): ${DATABASE_URL:0:50}..."

# Run migration
echo "🚀 Executing migration SQL..."
psql "$DATABASE_URL" -f database/migrations/009_add_monetization_events.sql

if [ $? -eq 0 ]; then
  echo "✅ Migration 009 completed successfully!"
  echo ""
  echo "📊 Verifying constraint..."
  psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conname = 'valid_event_type';"
  echo ""
  echo "🎉 Database now accepts: skin_purchased, item_unlocked, item_equipped"
else
  echo "❌ Migration failed!"
  exit 1
fi

