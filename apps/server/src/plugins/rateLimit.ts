import { Elysia } from 'elysia'
import { ErrorCode } from '../lib/errors.ts'
import { authPlugin } from './auth.ts'

type Bucket = { count: number; reset: number }
const buckets = new Map<string, Bucket>()

// V8 Phase 8: Specific HTTP Rate Limits by method & route pattern
type RouteRule = {
  method?: string
  regex: RegExp
  key: string
  max: number
  windowMs: number
  perIp?: boolean
}

const routePatterns: RouteRule[] = [
  {
    method: 'POST',
    regex: /^\/auth\/login$/,
    key: 'POST:/auth/login',
    max: 5,
    windowMs: 60000,
    perIp: true, // 5/min per IP
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

// Periodic cleanup every 5 minutes (Fix #5 - prevents in-memory map leak)
const cleanupInterval = setInterval(
  () => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.reset < now - 60000) {
        buckets.delete(key)
      }
    }
  },
  5 * 60 * 1000,
)

cleanupInterval.unref?.()

export const rateLimitPlugin = new Elysia({ name: 'rateLimit' })
  .use(authPlugin)
  .onBeforeHandle({ as: 'global' }, ({ user, request, set }) => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1'

    // V8 Phase 8: HTTP Body size limits
    const contentLength = request.headers.get('content-length')
    if (contentLength) {
      const bytes = Number.parseInt(contentLength, 10)
      const maxBodyBytes = path.startsWith('/uploads')
        ? 10 * 1024 * 1024 // 10MB max for uploads
        : 100 * 1024 // 100KB max for JSON bodies / messages
      if (bytes > maxBodyBytes) {
        set.status = 413
        return { message: 'Payload too large', code: ErrorCode.PAYLOAD_TOO_LARGE }
      }
    }

    const matched = getRouteRuleAndLimit(method, path)
    // For routes marked perIp (e.g., /auth/login), key by IP; otherwise key by authenticated userId
    const identifier = matched.perIp ? ip : user?.id || ip
    const bucketKey = `${identifier}:${matched.key}`

    const now = Date.now()
    const bucket = buckets.get(bucketKey)

    if (!bucket || bucket.reset < now) {
      buckets.set(bucketKey, { count: 1, reset: now + matched.windowMs })
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
