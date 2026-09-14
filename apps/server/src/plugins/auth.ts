import { cookie } from '@elysiajs/cookie'
import { jwt } from '@elysiajs/jwt'
import { Elysia } from 'elysia'

export type JwtPayload = { sub: string; email?: string }

export const authPlugin = new Elysia({ name: 'auth' })
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      exp: '15m',
    }),
  )
  .use(cookie())
  .derive({ as: 'global' }, async ({ jwt, cookie, headers, query }) => {
    // Try 1: HttpOnly cookie (web)
    const cookieToken = cookie.access_token?.value
    // Try 2: Authorization header (native)
    const authHeader = headers.authorization
    const headerToken = authHeader ? authHeader.replace('Bearer ', '') : undefined
    // Try 3: Query param (native WS fallback)
    const queryToken = (query as Record<string, string | undefined>).token

    const token = cookieToken || headerToken || queryToken
    if (!token) {
      return { user: null as { id: string; email?: string } | null }
    }

    try {
      const payload = (await jwt.verify(token)) as unknown as JwtPayload
      if (!payload?.sub) return { user: null as { id: string; email?: string } | null }
      return { user: { id: payload.sub, email: payload.email } }
    } catch {
      return { user: null as { id: string; email?: string } | null }
    }
  })
