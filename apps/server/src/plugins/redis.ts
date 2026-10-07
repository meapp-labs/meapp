import { Elysia } from 'elysia'
import Redis from 'ioredis'

import { env } from '../lib/config.ts'
import { logger } from '../lib/logger.ts'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  enableOfflineQueue: false,
})

let available = false
redis.on('ready', () => {
  available = true
  logger.info('redis.ready')
})
redis.on('error', (err) => {
  if (available) {
    available = false
    logger.warn('redis.degraded', { err })
  }
})
redis.on('close', () => {
  if (available) {
    available = false
    logger.warn('redis.disconnected')
  }
})

// Non-blocking connection attempt
redis.connect().catch((err: Error) => {
  logger.warn('redis.degraded', { err })
})

export const redisPlugin = new Elysia({ name: 'redis' }).decorate('redis', redis)
