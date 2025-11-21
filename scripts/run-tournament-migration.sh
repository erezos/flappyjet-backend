#!/bin/bash
# Run tournament schema migration on Railway database

set -e

echo "🏆 Running tournament schema migration..."
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL environment variable is not set"
  echo "💡 Run this script with Railway CLI:"
  echo "   railway run bash scripts/run-tournament-migration.sh"
  exit 1
fi

echo "✅ DATABASE_URL found"
echo "📦 Connecting to database..."
echo ""

# Run migration
psql "$DATABASE_URL" -f database/migrations/008_tournaments_schema.sql

echo ""
echo "✅ Migration completed!"
echo ""
echo "🧪 Verifying migration..."

# Verify tables exist
psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_name IN ('tournaments', 'tournament_participants') ORDER BY table_name;"

echo ""
echo "🎯 Checking if tournament was created..."
psql "$DATABASE_URL" -c "SELECT id, name, status, start_date, end_date FROM tournaments ORDER BY start_date DESC LIMIT 1;"

echo ""
echo "✅ All done! Tournament system is ready!"

