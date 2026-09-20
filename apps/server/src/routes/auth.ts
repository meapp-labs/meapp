import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { db, eq, schema } from '@meapp/db'
import { loginSchema, pushTokenSchema, registerSchema } from '@meapp/shared'
import { Elysia } from 'elysia'

import { LOGIN_CONFIG, SESSION_COOKIE_NAME, isProduction } from '../lib/config.ts'
import {
  ApiError,
  ErrorCode,
  createAuthError,
  createRateLimitError,
  createUserExistsError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { redisPlugin } from '../plugins/redis.ts'
import { sessionJwtPlugin } from '../plugins/session.ts'

const scryptAsync = promisify(scryptCb)

const hashPassword = async (password: string, salt: string): Promise<string> => {
  const buf = (await scryptAsync(password, salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH)) as Buffer
  return buf.toString('hex')
}

const loginAttemptsKey = (username: string) => `ratelimit:login:${username}`

export const authRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(redisPlugin)
  .use(sessionJwtPlugin)

  .post(
    '/register',
    async ({ body, set }) => {
      const { username, password, platform } = body

      const existingUser = await handleAsyncOperation(
        async () => db.select().from(schema.users).where(eq(schema.users.username, username)).get(),
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
          db.insert(schema.users).values({
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
    async ({ body, cookie, sessionJwt, redis }) => {
      const { username, password, platform } = body

      // Check login rate limit via Redis
      const attemptKey = loginAttemptsKey(username)
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
        async () => db.select().from(schema.users).where(eq(schema.users.username, username)).get(),
        'Failed to retrieve user data',
        ErrorCode.DATABASE_ERROR,
      )

      const recordFailedAttempt = async () => {
        try {
          const current = await redis.incr(attemptKey)
          if (current === 1) {
            await redis.expire(attemptKey, LOGIN_CONFIG.LOCKOUT_DURATION_MS / 1000)
          }
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
        username: user.username ?? username,
        platform: user.platform ?? platform ?? 'web',
      })
      if (!token) {
        throw new ApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to create session', 500)
      }

      cookie[SESSION_COOKIE_NAME]?.set({
        value: token,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: LOGIN_CONFIG.SESSION_TTL_SECONDS,
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

    if (me.platform === 'android') {
      await handleAsyncOperation(
        async () =>
          db.update(schema.users).set({ pushToken: null }).where(eq(schema.users.id, me.id)),
        'Failed to delete push token',
        ErrorCode.DATABASE_ERROR,
      ).catch(() => undefined)
    }

    cookie[SESSION_COOKIE_NAME]?.remove()
    return 'logged_out'
  })

  .post('/me', ({ user }) => ({ username: requireUser(user).username }))

  .post(
    '/push-token',
    async ({ user, body }) => {
      const me = requireUser(user)

      if (me.platform !== 'android') {
        return { success: false, message: 'Push tokens only supported for Android' }
      }

      await handleAsyncOperation(
        async () =>
          db.update(schema.users).set({ pushToken: body.token }).where(eq(schema.users.id, me.id)),
        'Failed to store push token',
        ErrorCode.DATABASE_ERROR,
      )

      return { success: true }
    },
    { body: pushTokenSchema },
  )
