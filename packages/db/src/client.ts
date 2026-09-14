import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.ts'

// ─────────────────────────────────────────────────────────────
// DB client singleton (V6 Podman Fixed - FIX #6)
// ─────────────────────────────────────────────────────────────

const dbPath = process.env.DATABASE_URL || './data/data.db'

// Ensure parent directory exists
try {
  mkdirSync(dirname(dbPath), { recursive: true })
} catch {}

const sqlite = new Database(dbPath, {
  create: true,
})

sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA busy_timeout = 5000;')
sqlite.exec('PRAGMA synchronous = NORMAL;')
sqlite.exec('PRAGMA foreign_keys = ON;')

// FIX #6 - proper checkpoint handling on exit and termination signals
export const checkpoint = (): void => {
  try {
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    console.log('WAL checkpoint done')
  } catch (e) {
    console.error('Checkpoint failed', e)
  }
}

process.on('SIGINT', () => {
  checkpoint()
  process.exit(0)
})

process.on('SIGTERM', () => {
  checkpoint()
  process.exit(0)
})

process.on('beforeExit', () => {
  checkpoint()
})

export const db = drizzle(sqlite, { schema })
export { schema, sqlite }
export type DB = typeof db
