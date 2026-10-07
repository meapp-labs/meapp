import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { checkpoint, getDbInstance, runMigrations } from '@meapp/db'
import { E2E_SEND_MAX_BYTES } from '@meapp/shared'
import { Elysia } from 'elysia'

import { startBackgroundTask } from './lib/backgroundTask.ts'
import { env, isProduction } from './lib/config.ts'
import { devSeedRoutes } from './lib/devSeed.ts'
import { ApiError, ErrorCode, toErrorResponse } from './lib/errors.ts'
import { logger } from './lib/logger.ts'
import { authPlugin } from './plugins/auth.ts'
import { rateLimitPlugin } from './plugins/rateLimit.ts'
import { redis, redisPlugin } from './plugins/redis.ts'
import { authRoutes } from './routes/auth.ts'
import { cleanupExpiredDeviceLinks, deviceLinkRoutes } from './routes/deviceLink.ts'
import { e2eRelayRoutes } from './routes/e2eRelay.ts'
import { friendRoutes } from './routes/friends.ts'
import { groupRoutes } from './routes/groups.ts'
import { mediaRoutes, sweepMedia } from './routes/media.ts'
import { messageRoutes } from './routes/messages.ts'
import { profileRoutes, sweepProfileAvatars } from './routes/profiles.ts'
import { reactionRoutes } from './routes/reactions.ts'
import { receiptRoutes } from './routes/receipts.ts'
import { recoveryRoutes } from './routes/recovery.ts'
import { wsTicketRoutes } from './routes/wsTicket.ts'
import { chatWs, closeChatSocketsForRestart, startPubsub } from './ws/chat.ts'

const allowedOrigins: string[] =
  isProduction && env.DOMAIN
    ? env.DOMAIN.split(',')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => new URL(d.includes('://') ? d : `https://${d}`).origin)
    : []

// In dev, allow localhost origins; in prod only the explicit DOMAIN list.
const devOriginRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/
const corsOrigin = allowedOrigins.length > 0 ? allowedOrigins : devOriginRegex

export const app = new Elysia({
  serve: { development: !isProduction },
})
  .onRequest(({ set }) => {
    set.headers['X-Request-Id'] = crypto.randomUUID()
  })
  .onAfterHandle({ as: 'global' }, ({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
  })
  // Cookie sessions require credentialed CORS with an explicit origin.
  .use(
    cors({
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  )
  .use(isProduction ? new Elysia() : swagger())
  .use(redisPlugin)
  .use(authPlugin)
  .use(rateLimitPlugin)
  .onError(({ error, code, set, request, user }) => {
    logger.error('http.failed', {
      reqId: set.headers['X-Request-Id'],
      route: new URL(request.url).pathname,
      userId: user?.id,
      code,
      err: code === 'VALIDATION' ? { name: error.name } : error,
    })
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
      const dbRow = getDbInstance().sqlite.query('SELECT 1 as alive').get() as {
        alive?: number
      } | null
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
      bun: Bun.version,
      timestamp: new Date().toISOString(),
    }
  })
  // CSRF: match the complete configured origin for cookie-authenticated writes.
  .onBeforeHandle({ as: 'global' }, ({ request, set }) => {
    if (request.method !== 'GET' && isProduction) {
      const origin = request.headers.get('origin')
      if (origin) {
        let parsedOrigin: string | undefined
        try {
          parsedOrigin = new URL(origin).origin
        } catch {
          parsedOrigin = undefined
        }
        const allowed = parsedOrigin !== undefined && allowedOrigins.includes(parsedOrigin)
        if (!allowed) {
          set.status = 403
          return { message: 'Cross-origin request rejected', code: ErrorCode.FORBIDDEN }
        }
      }
    }
    return undefined
  })
  .use(authRoutes)
  .use(devSeedRoutes)
  .use(profileRoutes)
  .use(friendRoutes)
  .use(messageRoutes)
  .use(receiptRoutes)
  .use(reactionRoutes)
  .use(groupRoutes)
  .use(mediaRoutes)
  .use(e2eRelayRoutes)
  .use(deviceLinkRoutes)
  .use(recoveryRoutes)
  .use(wsTicketRoutes)
  .use(chatWs)

export type App = typeof app

const stopBackgroundTasks: (() => void)[] = []
const shutdown = () => {
  logger.info('server.shutdown')
  for (const stop of stopBackgroundTasks) stop()
  closeChatSocketsForRestart()
  checkpoint()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('beforeExit', () => {
  checkpoint()
})

if (import.meta.main) {
  // A new installation must have its schema before any HTTP or WS handler runs.
  runMigrations()
  cleanupExpiredDeviceLinks()
  stopBackgroundTasks.push(startBackgroundTask('media', sweepMedia, 15 * 60 * 1000))
  stopBackgroundTasks.push(
    startBackgroundTask('profile-avatars', sweepProfileAvatars, 15 * 60 * 1000),
  )
  app.listen(
    {
      port: env.PORT,
      hostname: env.HOST,
      // Socket-level cap — cannot be bypassed by chunked requests.
      maxRequestBodySize: E2E_SEND_MAX_BYTES,
      development: !isProduction,
    },
    () => {
      logger.info('server.started', { host: env.HOST, port: env.PORT, origins: allowedOrigins })
      void startPubsub(() => app.server ?? undefined)
    },
  )
}
