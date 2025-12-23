#!/bin/bash
# Quick Fix: Execute Migration 033 using Railway DATABASE_URL
# 
# This avoids:
# - Railway CLI \i path issues (server vs local filesystem)
# - Copy/paste truncation issues
# - Terminal encoding problems
#
# Usage: 
#   1. Get DATABASE_URL from Railway dashboard (Variables tab)
#   2. Run: DATABASE_URL="your_url" ./QUICK_FIX_MIGRATION_033.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/database/migrations/033_part3_add_constraint.sql"

if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: DATABASE_URL environment variable not set"
  echo ""
  echo "📋 To get your DATABASE_URL:"
  echo "   1. Go to Railway dashboard"
  echo "   2. Select your Postgres service"
  echo "   3. Go to Variables tab"
  echo "   4. Copy DATABASE_URL or POSTGRES_URL"
  echo ""
  echo "Then run:"
  echo "   DATABASE_URL='your_connection_string' $0"
  exit 1
fi

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

echo "📋 Executing migration: 033_part3_add_constraint.sql"
echo "📁 File: $MIGRATION_FILE"
echo "🔗 Database: $(echo $DATABASE_URL | sed 's/:[^:]*@/:***@/')" # Hide password
echo ""

psql "$DATABASE_URL" -f "$MIGRATION_FILE"

echo ""
echo "✅ Migration completed! Verifying..."

# Verify constraint was created
psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conname = 'valid_event_type' AND conrelid = 'events'::regclass;" -t

if [ $? -eq 0 ]; then
  echo "✅ Constraint 'valid_event_type' exists - Migration successful!"
else
  echo "⚠️  Could not verify constraint. Please check manually."
fi

