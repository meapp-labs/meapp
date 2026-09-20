import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.ts'

// ─────────────────────────────────────────────────────────────
// DB client factory & lazy singleton
// ─────────────────────────────────────────────────────────────

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

let defaultInstance: DbInstance | null = null

export const getDbInstance = (customPath?: string): DbInstance => {
  if (!defaultInstance) {
    defaultInstance = createDb(customPath)
  }
  return defaultInstance
}

export const checkpoint = (): void => {
  if (defaultInstance) {
    defaultInstance.checkpoint()
  }
}

export const db: DB = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const instance = getDbInstance()
    const value = Reflect.get(instance.db, prop, receiver)
    return typeof value === 'function' ? value.bind(instance.db) : value
  },
})

export const sqlite: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const instance = getDbInstance()
    const value = Reflect.get(instance.sqlite, prop, receiver)
    return typeof value === 'function' ? value.bind(instance.sqlite) : value
  },
})

export { schema }
