import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.ts'

// ─────────────────────────────────────────────────────────────
// DB client singleton
// Reads DATABASE_URL from env (set by Podman compose or .env).
// Defaults to ./data.db for local native dev.
// ─────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? './data.db'

const sqlite = new Database(DATABASE_URL, {
  // WAL mode: better concurrency for reads while writes are in progress
  create: true,
})

// Enable WAL mode, timeout, synchronous NORMAL, and foreign keys
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA busy_timeout = 5000;')
sqlite.exec('PRAGMA synchronous = NORMAL;')
sqlite.exec('PRAGMA foreign_keys = ON;')

// Graceful checkpoint on exit
process.on('beforeExit', () => {
  try {
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  } catch {}
})

export const db = drizzle(sqlite, { schema })
export { schema, sqlite }
export type DB = typeof db
