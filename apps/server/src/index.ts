import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { checkpoint, sqlite } from '@meapp/db'
import { Elysia } from 'elysia'

import { env, isProduction } from './lib/config.ts'
import { ApiError, ErrorCode, toErrorResponse } from './lib/errors.ts'
import { authPlugin } from './plugins/auth.ts'
import { rateLimitPlugin } from './plugins/rateLimit.ts'
import { redis, redisPlugin } from './plugins/redis.ts'
import { authRoutes } from './routes/auth.ts'
import { friendRoutes } from './routes/friends.ts'
import { messageRoutes } from './routes/messages.ts'
import { wsTicketRoutes } from './routes/wsTicket.ts'
import { chatWs } from './ws/chat.ts'

export const app = new Elysia()
  // Cookie sessions require credentialed CORS with an explicit origin.
  .use(
    cors({
      origin: isProduction && env.DOMAIN ? env.DOMAIN : /localhost|127\.0\.0\.1/,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  )
  .use(swagger())
  .use(redisPlugin)
  .use(authPlugin)
  .use(rateLimitPlugin)
  .onError(({ error, code, set }) => {
    if (error instanceof ApiError) {
      set.status = error.statusCode
      return error.toBody()
    }

    if (code === 'VALIDATION') {
      const validation = error as { on?: string; property?: string }
      set.status = 400
      return {
        message: 'Invalid input data',
        code: ErrorCode.VALIDATION_ERROR,
        details: { on: validation.on, property: validation.property },
      }
    }

    if (code === 'NOT_FOUND') {
      set.status = 404
      return { message: 'Not found', code: ErrorCode.ITEM_NOT_FOUND }
    }

    const { status, body } = toErrorResponse(error)
    set.status = status
    return body
  })
  .get('/health', async ({ set }) => {
    let dbStatus = 'down'
    let redisStatus = 'down'

    try {
      const dbRow = sqlite.query('SELECT 1 as alive').get() as { alive?: number } | null
      if (dbRow?.alive === 1) {
        dbStatus = 'ok'
      }
    } catch {
      dbStatus = 'error'
    }

    try {
      const pong = await redis.ping()
      if (pong === 'PONG') {
        redisStatus = 'ok'
      }
    } catch {
      redisStatus = 'error'
    }

    const healthy = dbStatus === 'ok'
    if (!healthy) {
      set.status = 503
    }

    return {
      status: healthy ? 'ok' : 'degraded',
      db: dbStatus,
      redis: redisStatus,
      podman: true,
      bun: '1.4.2',
      timestamp: new Date().toISOString(),
    }
  })
  .use(authRoutes)
  .use(friendRoutes)
  .use(messageRoutes)
  .use(wsTicketRoutes)
  .use(chatWs)

export type App = typeof app

const shutdown = () => {
  console.log('Shutting down server...')
  checkpoint()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('beforeExit', () => {
  checkpoint()
})

if (import.meta.main) {
  app.listen({ port: env.PORT, hostname: env.HOST }, () => {
    console.log(`🚀 Elysia server running at http://${env.HOST}:${env.PORT}`)
  })
}
