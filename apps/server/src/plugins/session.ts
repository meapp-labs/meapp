import { jwt } from '@elysiajs/jwt'
import { Elysia } from 'elysia'

import { LOGIN_CONFIG, env } from '../lib/config.ts'

/**
 * Separate from the short-lived access token in `authPlugin` so the REST session
 * can keep the 30 day lifetime the previous cookie-based sessions had.
 *
 * `exp` must be a duration string: a bare number is interpreted as an absolute
 * timestamp, which would make every session expire instantly.
 */
export const sessionJwtPlugin = new Elysia({ name: 'sessionJwt' }).use(
  jwt({
    name: 'sessionJwt',
    secret: env.JWT_SECRET,
    exp: `${LOGIN_CONFIG.SESSION_TTL_SECONDS}s`,
  }),
)
