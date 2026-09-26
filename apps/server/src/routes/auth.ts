import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { eq, getDbInstance, schema } from '@meapp/db'
import { loginSchema, pushTokenSchema, registerSchema } from '@meapp/shared'
import { Elysia } from 'elysia'

import { clientIpOf } from '../lib/clientIp.ts'
import { LOGIN_CONFIG, SESSION_COOKIE_NAME, isProduction } from '../lib/config.ts'
import {
  ApiError,
  ErrorCode,
  createAuthError,
  createAuthenticationRequiredError,
  createRateLimitError,
  createUserExistsError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { redisPlugin } from '../plugins/redis.ts'

const scryptAsync = promisify(scryptCb)

const hashPassword = async (password: string, salt: string): Promise<string> => {
  const buf = (await scryptAsync(password, salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH)) as Buffer
  return buf.toString('hex')
}

// Composite IP+username key: a per-username key alone would let anyone lock
// out arbitrary users with 5 failed logins.
const loginAttemptsKey = (ip: string, username: string) => `ratelimit:login:${ip}:${username}`
const LOGIN_ATTEMPT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count
`

export const authRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(redisPlugin)

  .post(
    '/register',
    async ({ body, set }) => {
      const { username, password, platform } = body

      const existingUser = await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.select()
            .from(schema.users)
            .where(eq(schema.users.username, username))
            .get(),
        'Failed to check existing user',
        ErrorCode.DATABASE_ERROR,
      )
      if (existingUser) {
        throw createUserExistsError(username)
      }

      const salt = randomBytes(LOGIN_CONFIG.SALT_LENGTH).toString('hex')
      const hash = await hashPassword(password, salt)
      const passwordHash = `${salt}:${hash}`
      const userId = Bun.randomUUIDv7()

      await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.insert(schema.users)
            .values({
              id: userId,
              username,
              passwordHash,
              platform: platform ?? 'web',
            }),
        'Failed to create user',
        ErrorCode.DATABASE_ERROR,
      )

      set.status = 201
      return username
    },
    { body: registerSchema },
  )

  .post(
    '/login',
    async ({ body, cookie, jwt: sessionJwt, redis, request, server }) => {
      const { username, password, platform, rememberMe } = body

      const attemptKey = loginAttemptsKey(clientIpOf(request, server), username)
      try {
        const attempts = await redis.get(attemptKey)
        if (attempts && Number.parseInt(attempts, 10) >= LOGIN_CONFIG.MAX_LOGIN_ATTEMPTS) {
          throw createRateLimitError('Too many login attempts. Please try again later.', {
            lockoutMinutes: LOGIN_CONFIG.LOCKOUT_DURATION_MS / 1000 / 60,
            maxAttempts: LOGIN_CONFIG.MAX_LOGIN_ATTEMPTS,
          })
        }
      } catch (err) {
        if (err instanceof ApiError) throw err
        // Degraded mode if Redis is offline
      }

      const user = await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.select()
            .from(schema.users)
            .where(eq(schema.users.username, username))
            .get(),
        'Failed to retrieve user data',
        ErrorCode.DATABASE_ERROR,
      )

      const recordFailedAttempt = async () => {
        try {
          await redis.eval(
            LOGIN_ATTEMPT_LUA,
            1,
            attemptKey,
            String(LOGIN_CONFIG.LOCKOUT_DURATION_MS),
          )
        } catch {}
      }

      if (!user) {
        await recordFailedAttempt()
        throw createAuthError('Invalid credentials')
      }

      const [salt, key] = user.passwordHash.split(':')
      if (!salt || !key) {
        await recordFailedAttempt()
        throw new ApiError(ErrorCode.DATA_CORRUPTION, 'User data is corrupted', 500)
      }

      const hashedBuffer = (await scryptAsync(
        password,
        salt,
        LOGIN_CONFIG.SCRYPT_KEY_LENGTH,
      )) as Buffer
      const keyBuffer = Buffer.from(key, 'hex')
      const matches =
        hashedBuffer.length === keyBuffer.length && timingSafeEqual(hashedBuffer, keyBuffer)

      if (!matches) {
        await recordFailedAttempt()
        throw createAuthError('Invalid credentials')
      }

      try {
        await redis.del(attemptKey)
      } catch {}

      const token = await sessionJwt.sign({
        sub: user.id,
        jti: Bun.randomUUIDv7(),
        username: user.username ?? username,
        platform: platform ?? user.platform ?? 'web',
      })
      if (!token) {
        throw new ApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to create session', 500)
      }

      cookie[SESSION_COOKIE_NAME]?.set({
        value: token,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: rememberMe ? LOGIN_CONFIG.SESSION_TTL_SECONDS : undefined,
        secure: isProduction,
      })

      if (platform !== 'web') {
        return { username, token }
      }

      return username
    },
    { body: loginSchema },
  )

  .post('/logout', async ({ user, cookie }) => {
    const me = requireUser(user)
    const sqlite = getDbInstance().sqlite
    sqlite.transaction(() => {
      sqlite
        .query('DELETE FROM revoked_tokens WHERE expires_at <= ?')
        .run(Math.floor(Date.now() / 1000))
      sqlite
        .query('INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)')
        .run(me.tokenId, me.id, me.expiresAt)
    })()

    // JWT platform claim may be stale — clear token for all native platforms.
    if (me.platform !== 'web') {
      await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.update(schema.users)
            .set({ pushToken: null })
            .where(eq(schema.users.id, me.id)),
        'Failed to delete push token',
        ErrorCode.DATABASE_ERROR,
      ).catch(() => undefined)
    }

    cookie[SESSION_COOKIE_NAME]?.remove()
    return 'logged_out'
  })

  .get('/me', ({ user }) => {
    const me = requireUser(user)
    const existing = getDbInstance()
      .sqlite.query('SELECT id, username FROM users WHERE id = ?')
      .get(me.id) as { id: string; username: string } | null
    if (!existing) throw createAuthenticationRequiredError()
    return existing
  })

  .post(
    '/push-token',
    async ({ user, body }) => {
      const me = requireUser(user)

      if (me.platform !== 'android') {
        return { success: false, message: 'Push tokens only supported for Android' }
      }

      await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.update(schema.users)
            .set({ pushToken: body.token })
            .where(eq(schema.users.id, me.id)),
        'Failed to store push token',
        ErrorCode.DATABASE_ERROR,
      )

      return { success: true }
    },
    { body: pushTokenSchema },
  )
