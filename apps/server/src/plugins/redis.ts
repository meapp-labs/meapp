import { Elysia } from 'elysia'
import Redis from 'ioredis'

import { env } from '../lib/config.ts'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  enableOfflineQueue: false,
})

redis.on('error', () => {
  // Swallowed in degraded/offline mode to avoid unhandled error events in tests
})

// Non-blocking connection attempt
redis.connect().catch((err: Error) => {
  console.warn('[Redis] Connection warning (running in degraded offline mode):', err.message)
})

export const redisPlugin = new Elysia({ name: 'redis' }).decorate('redis', redis)
