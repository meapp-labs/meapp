import { Elysia } from 'elysia'
import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

// Non-blocking connection attempt
redis.connect().catch((err: Error) => {
  console.warn('[Redis] Connection warning (running in degraded offline mode):', err.message)
})

export const redisPlugin = new Elysia({ name: 'redis' }).decorate('redis', redis)
