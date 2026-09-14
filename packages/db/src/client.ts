import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.ts'

// ─────────────────────────────────────────────────────────────
// DB client singleton
// Reads DATABASE_URL from env (set by Podman compose or .env).
// Defaults to ./data.db for local native dev.
// ─────────────────────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL'] ?? './data.db'

const sqlite = new Database(DATABASE_URL, {
  // WAL mode: better concurrency for reads while writes are in progress
  create: true,
})

// Enable WAL mode and foreign key enforcement on every connection
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA foreign_keys = ON;')

export const db = drizzle(sqlite, { schema })

export type DB = typeof db
