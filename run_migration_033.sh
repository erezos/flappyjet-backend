#!/bin/bash
# Run migration 033_part3_add_constraint.sql on Railway Postgres
# Usage: ./run_migration_033.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/database/migrations/033_part3_add_constraint.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

echo "📋 Running migration: 033_part3_add_constraint.sql"
echo "📁 File: $MIGRATION_FILE"
echo ""

# Method 1: Try using railway run with psql
if command -v railway &> /dev/null; then
  echo "🚀 Using Railway CLI to execute migration..."
  cd "$SCRIPT_DIR"
  cat "$MIGRATION_FILE" | railway run --service Postgres psql
else
  echo "❌ Railway CLI not found. Please install it or use manual method."
  exit 1
fi

