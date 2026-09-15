import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
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

const hashPassword = (password: string, salt: string): string =>
  scryptSync(password, salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH).toString('hex')

export const authRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(redisPlugin)
  .use(sessionJwtPlugin)

  .post(
    '/register',
    async ({ body, redisService, set }) => {
      const { username, password } = body

      const existingUser = await handleAsyncOperation(
        () => redisService.getUser(username),
        'Failed to check existing user',
        ErrorCode.DATABASE_ERROR,
      )
      if (existingUser) {
        throw createUserExistsError(username)
      }

      const salt = randomBytes(LOGIN_CONFIG.SALT_LENGTH).toString('hex')
      const wasSet = await handleAsyncOperation(
        () => redisService.createUser(username, `${salt}:${hashPassword(password, salt)}`),
        'Failed to create user',
        ErrorCode.DATABASE_ERROR,
      )
      if (wasSet !== 'OK') {
        throw createUserExistsError(username)
      }

      set.status = 201
      return username
    },
    { body: registerSchema },
  )

  .post(
    '/login',
    async ({ body, cookie, sessionJwt, redisService }) => {
      const { username, password, platform } = body

      const canAttempt = await redisService.checkRateLimit(username)
      if (!canAttempt) {
        throw createRateLimitError('Too many login attempts. Please try again later.', {
          lockoutMinutes: LOGIN_CONFIG.LOCKOUT_DURATION_MS / 1000 / 60,
          maxAttempts: LOGIN_CONFIG.MAX_LOGIN_ATTEMPTS,
        })
      }

      const user = await handleAsyncOperation(
        () => redisService.getUser(username),
        'Failed to retrieve user data',
        ErrorCode.DATABASE_ERROR,
      )
      if (!user) {
        await redisService.incrementLoginAttempts(username)
        throw createAuthError('Invalid credentials')
      }

      const [salt, key] = user.split(':')
      if (!salt || !key) {
        await redisService.incrementLoginAttempts(username)
        throw new ApiError(ErrorCode.DATA_CORRUPTION, 'User data is corrupted', 500)
      }

      const hashedBuffer = scryptSync(password, salt, LOGIN_CONFIG.SCRYPT_KEY_LENGTH)
      const keyBuffer = Buffer.from(key, 'hex')
      // timingSafeEqual throws on length mismatch, which corrupt hashes would hit.
      const matches =
        hashedBuffer.length === keyBuffer.length && timingSafeEqual(hashedBuffer, keyBuffer)

      if (!matches) {
        await redisService.incrementLoginAttempts(username)
        throw createAuthError('Invalid credentials')
      }

      await redisService.clearLoginAttempts(username)

      const token = await sessionJwt.sign({ sub: username, username, platform })
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

      return username
    },
    { body: loginSchema },
  )

  .post('/logout', async ({ user, cookie, redisService }) => {
    const me = requireUser(user)

    if (me.platform === 'android') {
      // A missing push token is not an error.
      await handleAsyncOperation(
        () => redisService.deletePushToken(me.username),
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
    async ({ user, body, redisService }) => {
      const me = requireUser(user)

      if (me.platform !== 'android') {
        return { success: false, message: 'Push tokens only supported for Android' }
      }

      await handleAsyncOperation(
        () => redisService.setPushToken(me.username, body.token),
        'Failed to store push token',
        ErrorCode.DATABASE_ERROR,
      )

      return { success: true }
    },
    { body: pushTokenSchema },
  )
