import { Elysia } from 'elysia'
import { authPlugin } from './auth.ts'

type Bucket = { count: number; reset: number }
const buckets = new Map<string, Bucket>()

// FIX #4 - pattern matcher regex to match parameterized route templates
const routePatterns = [
  { regex: /^\/auth\/login$/, key: '/auth/login', max: 5, windowMs: 60000 },
  {
    regex: /^\/rooms\/[^/]+\/messages$/,
    key: '/rooms/:roomId/messages',
    max: 100,
    windowMs: 60000,
  },
  { regex: /^\/ws\/ticket$/, key: '/ws/ticket', max: 20, windowMs: 60000 },
]

export const getRouteKeyAndLimit = (path: string) => {
  const cleanPath = path.split('?')[0] ?? path
  for (const r of routePatterns) {
    if (r.regex.test(cleanPath)) {
      return r
    }
  }
  return { key: 'default', max: 100, windowMs: 60000, regex: /.*/ }
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
  .onBeforeHandle(({ user, request, set }) => {
    const userId = user?.id || request.headers.get('x-forwarded-for') || 'anon'
    const url = new URL(request.url)
    const path = url.pathname

    const matched = getRouteKeyAndLimit(path)
    const bucketKey = `${userId}:${matched.key}`
    const now = Date.now()
    const bucket = buckets.get(bucketKey)

    if (!bucket || bucket.reset < now) {
      buckets.set(bucketKey, { count: 1, reset: now + matched.windowMs })
      return undefined
    }

    if (bucket.count >= matched.max) {
      set.status = 429
      set.headers['Retry-After'] = Math.ceil((bucket.reset - now) / 1000).toString()
      return { error: `Too many requests for ${matched.key}` }
    }
    bucket.count++
    return undefined
  })
