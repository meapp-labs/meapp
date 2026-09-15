import { Elysia } from 'elysia'
import Redis from 'ioredis'

import { env } from '../lib/config.ts'
import { RedisService } from '../services/redis.service.ts'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

// Non-blocking connection attempt
redis.connect().catch((err: Error) => {
  console.warn('[Redis] Connection warning (running in degraded offline mode):', err.message)
})

export const redisPlugin = new Elysia({ name: 'redis' })
  .decorate('redis', redis)
  .decorate('redisService', new RedisService(redis))
