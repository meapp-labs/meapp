import { runMigrations } from '@meapp/db'

console.log('[Migrate] Running database migrations...')
try {
  runMigrations()
  console.log('[Migrate] Database migrations completed successfully.')
  process.exit(0)
} catch (error) {
  console.error('[Migrate] Migration failed:', error)
  process.exit(1)
}
