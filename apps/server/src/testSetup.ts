import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep test migrations and accounts away from the local development database.
process.env.DATABASE_URL =
  process.env.MEAPP_TEST_DATABASE_URL ?? join(tmpdir(), `meapp-test-${crypto.randomUUID()}.db`)
