#!/bin/bash
# Fixed Migration Runner for Railway
# This script properly executes SQL migrations on Railway Postgres
# 
# ROOT CAUSE ANALYSIS:
# - Railway CLI's `\i` command looks for files on server filesystem, not local
# - Copy/paste truncates strings in terminal (encoding issue)
# - Solution: Pipe file content through Railway's connection
#
# Usage: ./run_migration_033_fixed.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/database/migrations/033_part3_add_constraint.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

echo "📋 Executing migration: 033_part3_add_constraint.sql"
echo "📁 File: $MIGRATION_FILE"
echo ""
echo "🔍 Method: Piping file content through Railway connection"
echo ""

# Change to railway-backend directory for Railway CLI context
cd "$SCRIPT_DIR"

# Method: Use Railway CLI to connect and pipe the file
# This ensures the file is read from local filesystem and executed on Railway DB
railway connect --service Postgres <<EOF
$(cat "$MIGRATION_FILE")
EOF

echo ""
echo "✅ Migration execution completed"

