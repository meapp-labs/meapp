import type { FastifyInstance } from 'fastify';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { z } from 'zod';

import { LOGIN_CONFIG } from '../lib/config';
import {
  ApiError,
  createAuthError,
  createDatabaseError,
  createRateLimitError,
  createUserExistsError,
  ErrorCode,
  handleError,
} from '../lib/errors';
import { handleAsyncOperation, handleSyncOperation } from '../lib/helpers';
import { passwordSchema, usernameSchema } from '../validation/validation';

import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyRedis } from '@fastify/redis';

export const authSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

async function checkRateLimit(
  redis: FastifyRedis,
  username: string,
): Promise<boolean> {
  try {
    const key = `login_attempts:${username}`;
    const attempts = await redis.get(key);
    return !attempts || parseInt(attempts) < LOGIN_CONFIG.MAX_LOGIN_ATTEMPTS;
  } catch (error) {
    throw createDatabaseError('rate limit check', error as Error);
  }
}

async function incrementLoginAttempts(
  redis: FastifyRedis,
  username: string,
): Promise<void> {
  try {
    const key = `login_attempts:${username}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, LOGIN_CONFIG.LOCKOUT_DURATION / 1000);
    }
  } catch (error) {
    throw createDatabaseError('increment login attempts', error as Error);
  }
}

async function clearLoginAttempts(
  redis: FastifyRedis,
  username: string,
): Promise<void> {
  try {
    await redis.del(`login_attempts:${username}`);
  } catch (error) {
    throw createDatabaseError('clear login attempts', error as Error);
  }
}

export function authRoutes(server: FastifyInstance) {
  const { redis } = server;

  // Registration endpoint
  server
    .withTypeProvider<ZodTypeProvider>()
    .post(
      '/register',
      { schema: { body: authSchema } },
      async (request, reply) => {
        try {
          const { username, password } = request.body;

          // Check if user already exists
          const existingUser = await handleAsyncOperation(
            () => redis.get(username),
            'Failed to check existing user',
            ErrorCode.DATABASE_ERROR,
          );

          if (existingUser) {
            throw createUserExistsError(username);
          }

          // Hash password
          const salt = randomBytes(LOGIN_CONFIG.SALT_LENGTH).toString('hex');
          const hashedPassword = scryptSync(
            password,
            salt,
            LOGIN_CONFIG.SCRYPT_KEY_LENGTH,
          ).toString('hex');

          // Store user
          const wasSet = await handleAsyncOperation(
            () => redis.set(username, `${salt}:${hashedPassword}`, 'NX'),
            'Failed to create user',
            ErrorCode.DATABASE_ERROR,
          );

          if (wasSet !== 'OK') {
            throw createUserExistsError(username);
          }

          reply.code(201).send(username);
        } catch (error) {
          const response = handleError(error, server);
          reply
            .code(response.code === ErrorCode.USER_ALREADY_EXISTS ? 409 : 500)
            .send(response);
        }
      },
    );

  // Login endpoint
  server
    .withTypeProvider<ZodTypeProvider>()
    .post(
      '/login',
      { schema: { body: authSchema } },
      async (request, reply) => {
        try {
          const { username, password } = request.body;

          // Check rate limiting
          const canAttempt = await checkRateLimit(redis, username);
          if (!canAttempt) {
            throw createRateLimitError(
              'Too many login attempts. Please try again later.',
              {
                lockoutDuration: LOGIN_CONFIG.LOCKOUT_DURATION / 1000 / 60,
                maxAttempts: LOGIN_CONFIG.MAX_LOGIN_ATTEMPTS,
              },
            );
          }

          // Get user data
          const user = await handleAsyncOperation(
            () => redis.get(username),
            'Failed to retrieve user data',
            ErrorCode.DATABASE_ERROR,
          );

          if (!user) {
            await incrementLoginAttempts(redis, username);
            throw createAuthError('Invalid credentials');
          }

          // Parse stored password
          const [salt, key] = user.split(':');
          if (!salt || !key) {
            await incrementLoginAttempts(redis, username);
            throw new ApiError(
              ErrorCode.DATA_CORRUPTION,
              'User data is corrupted',
              500,
            );
          }

          // Verify password
          const hashedBuffer = scryptSync(
            password,
            salt,
            LOGIN_CONFIG.SCRYPT_KEY_LENGTH,
          );
          const keyBuffer = Buffer.from(key, 'hex');
          const match = timingSafeEqual(hashedBuffer, keyBuffer);

          if (match) {
            await clearLoginAttempts(redis, username);

            // Set session (synchronous operation)
            handleSyncOperation(
              () => request.session.set('username', username),
              'Failed to create session',
              ErrorCode.SESSION_ERROR,
            );

            reply.code(200).send(username);
          } else {
            await incrementLoginAttempts(redis, username);
            throw createAuthError('Invalid credentials');
          }
        } catch (error) {
          const response = handleError(error, server);
          const statusCode =
            response.code === ErrorCode.TOO_MANY_ATTEMPTS
              ? 429
              : response.code === ErrorCode.UNAUTHORIZED
                ? 401
                : 500;
          reply.code(statusCode).send(response);
        }
      },
    );

  // Logout endpoint
  server.post('/logout', async (request, reply) => {
    try {
      // Delete session (synchronous operation)
      handleSyncOperation(
        () => request.session.delete(),
        'Failed to destroy session',
        ErrorCode.SESSION_ERROR,
      );

      reply.code(200).send('logged_out');
    } catch (error) {
      const response = handleError(error, server);
      reply.code(500).send(response);
    }
  });
}
