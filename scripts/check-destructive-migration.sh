#!/bin/sh
set -e

# ==============================================================================
# MeApp Phase 7: Destructive Migration Guard
# Blocks unapproved DROP COLUMN / DROP TABLE DDL in CI
# ==============================================================================

DIRS_TO_CHECK=""
[ -d "packages/db/drizzle" ] && DIRS_TO_CHECK="$DIRS_TO_CHECK packages/db/drizzle"
[ -d "migrations" ] && DIRS_TO_CHECK="$DIRS_TO_CHECK migrations"

if [ -n "$DIRS_TO_CHECK" ]; then
  if grep -r -i -E "DROP COLUMN|DROP TABLE|ALTER TABLE.*DROP" $DIRS_TO_CHECK --include="*.sql" --include="*.ts" 2>/dev/null; then
    echo "❌ Destructive migration detected!"
    echo "If intentional, add label 'allow-destructive-migration' to PR and get 2 approvals."
    echo "Ensure it is executed during Release N+2 (contract phase), not N or N+1."

    if [ "$ALLOW_DESTRUCTIVE" != "true" ]; then
      exit 1
    fi
  fi
fi

echo "✅ No destructive migration or allowed"
