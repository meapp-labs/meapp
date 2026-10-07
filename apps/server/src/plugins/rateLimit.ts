import { E2E_SEND_MAX_BYTES } from '@meapp/shared'
import { Elysia } from 'elysia'
import { clientIpOf } from '../lib/clientIp.ts'
import { ErrorCode } from '../lib/errors.ts'
import { RATE_LIMIT_LUA } from '../lib/redisScripts.ts'
import { authPlugin } from './auth.ts'
import { redis } from './redis.ts'

type Bucket = { count: number; reset: number }
const inMemoryBuckets = new Map<string, Bucket>()
let rateLimitPrefix = 'ratelimit'

// Specific HTTP Rate Limits by method & route pattern
export type RouteRule = {
  method?: string
  regex: RegExp
  key: string
  max: number
  windowMs: number
  perIp?: boolean
}

export const routePatterns: RouteRule[] = [
  {
    method: 'POST',
    regex: /^\/api\/reactions$/,
    key: 'POST:/api/reactions',
    max: 60,
    windowMs: 60000,
  },
  {
    method: 'GET',
    regex: /^\/api\/reactions$/,
    key: 'GET:/api/reactions',
    max: 180,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/read$/,
    key: 'POST:/api/read',
    max: 180,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/profile(?:\/avatar(?:\/remove)?)?$/,
    key: 'POST:/api/profile',
    max: 10,
    windowMs: 60000,
  },
  {
    method: 'GET',
    regex: /^\/api\/profiles(?:\/[a-f0-9-]+)?$/,
    key: 'GET:/api/profiles',
    max: 100,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/contact-aliases\/[a-f0-9-]+$/,
    key: 'POST:/api/contact-aliases',
    max: 30,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/media\/(intent|[a-f0-9-]+\/commit)$/,
    key: 'POST:/api/media',
    max: 20,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/login$/,
    key: 'POST:/api/login',
    max: 5,
    windowMs: 60000,
    perIp: true, // 5/min per IP
  },
  {
    method: 'POST',
    regex: /^\/api\/register$/,
    key: 'POST:/api/register',
    max: 5,
    windowMs: 60000,
    perIp: true, // 5/min per IP
  },
  {
    method: 'POST',
    regex: /^\/ws\/ticket$/,
    key: 'POST:/ws/ticket',
    max: 20,
    windowMs: 60000, // 20/min per user
  },
  {
    method: 'GET',
    regex: /^\/api\/conversations$/,
    key: 'GET:/api/conversations',
    max: 100,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/conversations$/,
    key: 'POST:/api/conversations',
    max: 30,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/send-message$/,
    key: 'POST:/api/send-message',
    max: 30,
    windowMs: 60000,
  },
  {
    method: 'GET',
    regex: /^\/api\/get-messages$/,
    key: 'GET:/api/get-messages',
    max: 100,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex:
      /^\/api\/(add-other|remove-other|friend-requests\/(accept|cancel|ignore)|ignored-users\/remove)$/,
    key: 'POST:/api/others',
    max: 30,
    windowMs: 60000,
  },
  {
    method: 'GET',
    regex: /^\/api\/(get-others|friend-requests|ignored-users)$/,
    key: 'GET:/api/get-others',
    max: 100,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/relay\/bundle$/,
    key: 'POST:/api/e2e/relay/bundle',
    max: 30,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/relay\/prekeys$/,
    key: 'POST:/api/e2e/relay/prekeys',
    max: 10,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/link\/(start|connect|complete|ack|revoke)$/,
    key: 'POST:/api/e2e/link/control',
    max: 20,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/link\/history$/,
    key: 'POST:/api/e2e/link/history',
    max: 100,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/recovery\/(backup|claim)$/,
    key: 'POST:/api/e2e/recovery',
    max: 10,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/recovery\/backup\/(chunk|commit)$/,
    key: 'POST:/api/e2e/recovery/backup-parts',
    max: 120,
    windowMs: 60000,
  },
]

export const getRouteRuleAndLimit = (method: string, path: string): RouteRule => {
  const cleanPath = path.split('?')[0] ?? path
  for (const r of routePatterns) {
    if ((!r.method || r.method === method) && r.regex.test(cleanPath)) {
      return r
    }
  }
  return {
    regex: /.*/,
    key: `${method}:${cleanPath}`,
    max: 100,
    windowMs: 60000, // Default: 100/min per user
  }
}

// Periodic cleanup every 5 minutes to prevent in-memory map leak
const cleanupInterval = setInterval(
  () => {
    const now = Date.now()
    for (const [key, bucket] of inMemoryBuckets) {
      if (bucket.reset < now - 60000) {
        inMemoryBuckets.delete(key)
      }
    }
  },
  5 * 60 * 1000,
)

cleanupInterval.unref?.()

/** Test-only: clear fallback buckets and isolate Redis counters with a fresh namespace. */
export const resetInMemoryRateLimits = (): void => {
  inMemoryBuckets.clear()
  rateLimitPrefix = `meapp:test:${crypto.randomUUID()}:ratelimit`
}

function bodyLimit(request: Request): number {
  const path = new URL(request.url).pathname
  if (request.method === 'POST' && path === '/api/send-message') return E2E_SEND_MAX_BYTES
  if (
    request.method === 'POST' &&
    [
      '/api/e2e/relay/prekeys',
      '/api/e2e/link/history',
      '/api/e2e/recovery/backup/chunk',
      '/api/e2e/recovery/backup',
    ].includes(path)
  )
    return 700 * 1024
  return 100 * 1024
}

export const rateLimitPlugin = new Elysia({ name: 'rateLimit' })
  .use(authPlugin)
  .onRequest(async ({ request, set }) => {
    const maxBytes = bodyLimit(request)
    const tooLarge = () => {
      set.status = 413
      return { message: 'Payload too large', code: ErrorCode.PAYLOAD_TOO_LARGE }
    }
    if (Number(request.headers.get('content-length')) > maxBytes) return tooLarge()
    // Keep smaller route limits even when the socket cap permits large group sends.
    // Count actual bytes before parsing; an absent or false length cannot bypass this.
    const reader = request.body ? request.clone().body?.getReader() : undefined
    if (!reader) return undefined
    let bytes = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return undefined
        bytes += chunk.value.byteLength
        if (bytes > maxBytes) {
          void reader.cancel().catch(() => undefined)
          return tooLarge()
        }
      }
    } finally {
      reader.releaseLock()
    }
  })
  .as('global')
  .onBeforeHandle({ as: 'global' }, async ({ user, request, set, server }) => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    const ip = clientIpOf(request, server)

    const matched = getRouteRuleAndLimit(method, path)
    const identifier = matched.perIp ? ip : user?.id || ip
    const key = `${rateLimitPrefix}:${identifier}:${matched.key}`
    const windowSec = Math.ceil(matched.windowMs / 1000)

    if (redis.status === 'ready') {
      try {
        const current = (await redis.eval(
          RATE_LIMIT_LUA,
          1,
          key,
          windowSec.toString(),
          matched.max.toString(),
        )) as number

        if (current > matched.max) {
          const ttl = await redis.ttl(key)
          set.status = 429
          set.headers['Retry-After'] = (ttl > 0 ? ttl : windowSec).toString()
          return { message: `Too many requests for ${matched.key}`, code: ErrorCode.RATE_LIMITED }
        }
        return undefined
      } catch {
        // Fall through to in-memory fallback
      }
    }

    // In-memory fallback if Redis is unavailable or offline
    const now = Date.now()
    const bucket = inMemoryBuckets.get(key)

    if (!bucket || bucket.reset < now) {
      inMemoryBuckets.set(key, { count: 1, reset: now + matched.windowMs })
      return undefined
    }

    if (bucket.count >= matched.max) {
      set.status = 429
      set.headers['Retry-After'] = Math.ceil((bucket.reset - now) / 1000).toString()
      return { message: `Too many requests for ${matched.key}`, code: ErrorCode.RATE_LIMITED }
    }

    bucket.count++
    return undefined
  })
