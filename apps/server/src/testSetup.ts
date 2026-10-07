import { beforeEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep test migrations and accounts away from the local development database.
process.env.DATABASE_URL =
  process.env.MEAPP_TEST_DATABASE_URL ?? join(tmpdir(), `meapp-test-${crypto.randomUUID()}.db`)

// Redis may be online during local development. Isolate rate-limit counters
// without flushing shared Redis or changing WebSocket pub/sub channel names.
const { resetInMemoryRateLimits } = await import('./plugins/rateLimit.ts')
beforeEach(resetInMemoryRateLimits)
