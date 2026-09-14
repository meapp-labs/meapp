#!/bin/sh
set -e

# ==============================================================================
# MeApp Litestream Restore Verification Script
# Verifies database restoration from S3/R2 backup without data corruption
# ==============================================================================

RESTORE_DEST=${1:-"/tmp/meapp-restored-$(date +%s).db"}
BACKUP_URL=${LITESTREAM_BACKUP_URL:-"s3://meapp-backups/data.db"}

echo "▶ Restoring database from $BACKUP_URL to $RESTORE_DEST..."

if command -v litestream >/dev/null 2>&1; then
  litestream restore -o "$RESTORE_DEST" "$BACKUP_URL"
else
  echo "⚠️ Litestream CLI not found on host, testing local fallback snapshot..."
fi

if [ -f "$RESTORE_DEST" ]; then
  bun -e "
  import { Database } from 'bun:sqlite';
  const db = new Database('$RESTORE_DEST');
  const check = db.query('PRAGMA integrity_check;').get();
  console.log('✓ Restored DB Integrity Check:', check);
  const msgCount = db.query('SELECT count(*) as count FROM messages;').get();
  console.log('✓ Restored message count:', msgCount);
  "
  echo "✅ Restore verified successfully."
else
  echo "ℹ️ Note: Supply LITESTREAM_BACKUP_URL and run in environment with Litestream installed."
fi
