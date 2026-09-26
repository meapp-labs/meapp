import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.ts'

export type DB = ReturnType<typeof drizzle<typeof schema>>

export type DbInstance = {
  db: DB
  sqlite: Database
  checkpoint: () => void
}

export const createDb = (customPath?: string): DbInstance => {
  const dbPath = customPath || process.env.DATABASE_URL || './data/data.db'

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

  // Restrict the SQLite file and directory on Unix hosts. The database holds
  // plaintext until the device-side encryption rollout is complete.
  if (process.platform !== 'win32') {
    try {
      chmodSync(dirname(dbPath), 0o700)
      chmodSync(dbPath, 0o600)
    } catch (error) {
      console.warn('[DB] Could not restrict database permissions:', error)
    }
  }

  const checkpoint = (): void => {
    try {
      sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);')
      console.log('WAL checkpoint done')
    } catch (e) {
      console.error('Checkpoint failed', e)
    }
  }

  const db = drizzle(sqlite, { schema })

  return { db, sqlite, checkpoint }
}

// Lazy singletons: opening the file at import time would create data.db during
// builds/tests with the wrong user or an unwanted file. First access happens
// at server startup (or in tests after migrations).
let defaultInstance: DbInstance | null = null

export const getDbInstance = (customPath?: string): DbInstance => {
  if (customPath) {
    return createDb(customPath)
  }
  if (!defaultInstance) {
    defaultInstance = createDb()
  }
  return defaultInstance
}

export const checkpoint = (): void => {
  getDbInstance().checkpoint()
}

export { schema }

// Lazy accessors. Named `db`/`sqlite` getters on a namespace object would not
// be name-compatible with the previous `export const` usage, so re-export via
// init-time binding only where the server actually opens the DB (index.ts /
// migrate.ts call getDbInstance() first).
export const openDefaultDb = (): DbInstance => getDbInstance()
