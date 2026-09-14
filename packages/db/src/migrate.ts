import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from './client.ts'

export const runMigrations = (migrationsFolder?: string): void => {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const folder = migrationsFolder ?? join(currentDir, '../drizzle')
  migrate(db, { migrationsFolder: folder })
}
