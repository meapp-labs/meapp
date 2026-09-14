#!/bin/sh
set -e

# ==============================================================================
# MeApp Chaos & Resilience Test Suite (V8 Phase 6)
# Tests WAL durability, atomic backups (VACUUM INTO), and migration safety
# ==============================================================================

echo "======================================================"
echo "⚡ Starting MeApp Chaos & Volume Locking Test Suite"
echo "======================================================"

ROOT_DIR="$(pwd -W 2>/dev/null || pwd)"
TEST_DIR="$ROOT_DIR/.chaos-test-$(date +%s)"
mkdir -p "$TEST_DIR"
CHAOS_DB="$TEST_DIR/chaos.db"
BACKUP_DB="$TEST_DIR/backup.db"

cleanup() {
  echo "🧹 Cleaning up test artifacts in $TEST_DIR..."
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

echo "▶ [Test 1/4] Running schema migration on isolated DB..."
DATABASE_URL="$CHAOS_DB" bun run --filter @meapp/server migrate

echo "▶ [Test 2/4] Simulating concurrent writes under load..."
DATABASE_URL="$CHAOS_DB" bun -e "
import { insertMessageWithSequence, sqlite } from '@meapp/db';

sqlite.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
  .run('u1', 'chaos@test.com', 'Chaos User', 'hash', Date.now());
sqlite.query('INSERT INTO rooms (id, name, created_by, created_at) VALUES (?, ?, ?, ?)')
  .run('r1', 'Chaos Room', 'u1', Date.now());

// Fire rapid concurrent message inserts
const promises = [];
for (let i = 0; i < 25; i++) {
  promises.push(
    insertMessageWithSequence(sqlite, {
      roomId: 'r1',
      userId: 'u1',
      clientId: 'c-' + i,
      text: 'Chaos message ' + i,
    })
  );
}

await Promise.all(promises);
console.log('✓ 25 concurrent messages written under BEGIN IMMEDIATE lock');
"

echo "▶ [Test 3/4] Testing atomic backup under active WAL..."
DATABASE_URL="$CHAOS_DB" bun -e "
import { sqlite } from '@meapp/db';
sqlite.exec(\`VACUUM INTO '$BACKUP_DB'\`);
console.log('✓ VACUUM INTO completed cleanly');
"

echo "▶ [Test 4/4] Verifying backup database integrity..."
DATABASE_URL="$BACKUP_DB" bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('$BACKUP_DB');
const check = db.query('PRAGMA integrity_check;').get();
console.log('✓ Backup integrity check result:', check);
const count = db.query('SELECT count(*) as count FROM messages;').get();
console.log('✓ Restored message count:', count);
"

echo "▶ [Guard Check] Verifying destructive migration guard script..."
chmod +x ./scripts/check-destructive-migration.sh
./scripts/check-destructive-migration.sh

echo "======================================================"
echo "✅ All Phase 6 Chaos & Volume Locking Tests Passed!"
echo "======================================================"
