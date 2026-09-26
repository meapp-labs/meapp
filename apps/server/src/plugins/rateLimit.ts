import { Elysia } from 'elysia'
import { ErrorCode } from '../lib/errors.ts'
import { authPlugin } from './auth.ts'
import { redis } from './redis.ts'

type Bucket = { count: number; reset: number }
const inMemoryBuckets = new Map<string, Bucket>()

/** Atomic fixed-window counter: INCR + EXPIRE in one roundtrip. */
const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`

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
    regex: /^\/api\/(add-other|remove-other)$/,
    key: 'POST:/api/others',
    max: 30,
    windowMs: 60000,
  },
  {
    method: 'GET',
    regex: /^\/api\/get-others$/,
    key: 'GET:/api/get-others',
    max: 100,
    windowMs: 60000,
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/bundle$/,
    key: 'POST:/api/e2e/bundle',
    max: 10,
    windowMs: 60000, // 10/min per user (Phase 10 §10.9)
  },
  {
    method: 'GET',
    regex: /^\/api\/e2e\/bundle$/,
    key: 'GET:/api/e2e/bundle',
    max: 30,
    windowMs: 60000, // 30/min per user (Phase 10 §10.9)
  },
  {
    method: 'POST',
    regex: /^\/api\/e2e\/device$/,
    key: 'POST:/api/e2e/device',
    max: 10,
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
    method: 'GET',
    regex: /^\/rooms\/[^/]+\/messages$/,
    key: 'GET:/rooms/:roomId/messages',
    max: 100,
    windowMs: 60000, // 100/min per user
  },
  {
    method: 'POST',
    regex: /^\/rooms\/[^/]+\/messages$/,
    key: 'POST:/rooms/:roomId/messages',
    max: 30,
    windowMs: 60000, // 30/min per user
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

/** Test-only: clears the in-memory fallback buckets (Redis-backed limits expire on their own). */
export const resetInMemoryRateLimits = (): void => {
  inMemoryBuckets.clear()
}

export const rateLimitPlugin = new Elysia({ name: 'rateLimit' })
  .use(authPlugin)
  .onBeforeHandle({ as: 'global' }, async ({ user, request, set, server }) => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // requestIP is authoritative; x-forwarded-for is client-forgeable.
    const socketIp = server?.requestIP?.(request)?.address
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const ip = socketIp || forwarded || '127.0.0.1'

    // E2E group sends contain one ciphertext per recipient; key publication
    // contains a batch of post-quantum public keys. The socket enforces 700KB.
    const contentLength = request.headers.get('content-length')
    if (contentLength) {
      const bytes = Number.parseInt(contentLength, 10)
      const needsE2EBatch =
        method === 'POST' &&
        (path === '/api/send-message' ||
          path === '/api/e2e/relay/prekeys' ||
          path === '/api/e2e/link/history')
      const maxBytes = needsE2EBatch ? 700 * 1024 : 100 * 1024
      if (bytes > maxBytes) {
        set.status = 413
        return { message: 'Payload too large', code: ErrorCode.PAYLOAD_TOO_LARGE }
      }
    }

    const matched = getRouteRuleAndLimit(method, path)
    const identifier = matched.perIp ? ip : user?.id || ip
    const key = `ratelimit:${identifier}:${matched.key}`
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
