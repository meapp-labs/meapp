#!/bin/sh
set -e

# V8 CI Check: Prevent accidental destructive migrations
if grep -r -i -E "DROP COLUMN|DROP TABLE|ALTER TABLE.*DROP" packages/db/drizzle/ --include="*.sql" --include="*.ts" 2>/dev/null; then
  echo "❌ Destructive migration detected!"
  echo "If intentional, add label 'allow-destructive-migration' to PR and get 2 approvals"
  echo "And ensure it's Release N+2 (contract phase), not N or N+1"

  if [ "$ALLOW_DESTRUCTIVE" != "true" ]; then
    exit 1
  fi
fi

echo "✅ No destructive migration or allowed"
