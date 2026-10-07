import { scryptSync } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// All accounts, secrets, objects and recovery files belong to this disposable run.
const root = join(tmpdir(), 'meapp-built-validation-20261007')
await mkdir(root, { recursive: true })
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_URL: join(root, 'browser.db'),
  PORT: '18080',
  HOST: '127.0.0.1',
  REDIS_URL: 'redis://127.0.0.1:16379',
  JWT_SECRET: 'isolated-validation-secret-20261007',
  WS_TICKET_SECRET: 'isolated-validation-ticket-20261007',
  MEDIA_STORAGE: 'local',
  MEDIA_LOCAL_DIRECTORY: join(root, 'media'),
  MEDIA_LOCAL_PUBLIC_URL: 'http://127.0.0.1:18082',
  MEDIA_LOCAL_PORT: '18082',
  R2_ACCOUNT_ID: '',
  R2_ACCESS_KEY_ID: '',
  R2_SECRET_ACCESS_KEY: '',
  R2_BUCKET: '',
  R2_PUBLIC_URL: '',
})
const { getDbInstance, runMigrations } = await import('@meapp/db')
const { seedDevData } = await import('../../apps/server/src/lib/devSeed')
const { app } = await import('../../apps/server/src/index')
const { startPubsub } = await import('../../apps/server/src/ws/chat')
const { E2E_SEND_MAX_BYTES } = await import('@meapp/shared')
runMigrations()
await seedDevData()
// An exported bundle uses production password validation even for a local dev API.
const salt = 'isolated-validation'
const password = 'Validation2026Local'
const hash = scryptSync(password, salt, 64).toString('hex')
getDbInstance()
  .sqlite.query('UPDATE users SET password_hash=? WHERE username IN (?, ?, ?)')
  .run(`${salt}:${hash}`, 'emil1', 'emil2', 'emil3')
app.listen({ hostname: '127.0.0.1', port: 18080, maxRequestBodySize: E2E_SEND_MAX_BYTES })
await startPubsub(() => app.server ?? undefined)
await import('../../apps/server/src/localMediaServer')
console.log('Isolated validation API/media ready; seeded login password: Validation2026Local')
