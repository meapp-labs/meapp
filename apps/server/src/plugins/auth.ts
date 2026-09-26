import { jwt } from '@elysiajs/jwt'
import { getDbInstance } from '@meapp/db'
import { Elysia } from 'elysia'

import { LOGIN_CONFIG, SESSION_COOKIE_NAME, env } from '../lib/config.ts'
import type { SessionUser } from '../lib/session.ts'

type JwtPayload = {
  sub?: string
  username?: string
  platform?: string
  jti?: string
  exp?: number
}

/**
 * Resolves the caller from, in order: the HttpOnly session cookie (web), or the
 * Authorization header (native).
 * WebSocket authentication uses single-use tickets (/ws/ticket).
 */
export const authPlugin = new Elysia({ name: 'auth' })
  .use(
    jwt({
      name: 'jwt',
      secret: env.JWT_SECRET,
      exp: `${LOGIN_CONFIG.SESSION_TTL_SECONDS}s`,
    }),
  )
  .derive({ as: 'global' }, async ({ jwt, cookie, headers }) => {
    const cookieToken = cookie[SESSION_COOKIE_NAME]?.value
    const authHeader = headers.authorization
    const headerToken = authHeader?.replace('Bearer ', '')

    const token = (typeof cookieToken === 'string' ? cookieToken : undefined) || headerToken

    if (!token) {
      return { user: null as SessionUser | null }
    }

    try {
      const payload = (await jwt.verify(token)) as JwtPayload | false
      if (!payload || !payload.sub || !payload.jti || !payload.exp) {
        return { user: null as SessionUser | null }
      }

      const sqlite = getDbInstance().sqlite
      const existing = sqlite
        .query(`SELECT u.username FROM users u
          WHERE u.id = ? AND NOT EXISTS (
            SELECT 1 FROM revoked_tokens r WHERE r.jti = ?
          )`)
        .get(payload.sub, payload.jti) as { username: string | null } | null
      if (!existing) return { user: null as SessionUser | null }

      return {
        user: {
          id: payload.sub,
          username: existing.username ?? payload.sub,
          platform: payload.platform ?? 'web',
          tokenId: payload.jti,
          expiresAt: payload.exp,
        } satisfies SessionUser,
      }
    } catch {
      return { user: null as SessionUser | null }
    }
  })
