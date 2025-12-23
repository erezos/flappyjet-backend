#!/bin/bash
# Railway Migration Runner
# Executes SQL migration files on Railway Postgres database
# Usage: ./run_migration.sh <migration_file>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <migration_file>"
  echo "Example: $0 database/migrations/033_part3_add_constraint.sql"
  exit 1
fi

MIGRATION_FILE="$1"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

echo "📋 Executing migration: $MIGRATION_FILE"
echo ""

# Pipe file content into Railway psql
cat "$MIGRATION_FILE" | railway run --service Postgres psql

echo ""
echo "✅ Migration execution completed"

