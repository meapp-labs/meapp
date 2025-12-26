import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { LOGIN_CONFIG } from '@/lib/config.ts';
import {
  ApiError,
  ErrorCode,
  createAuthError,
  createRateLimitError,
  createUserExistsError,
  handleError,
} from '@/lib/errors.ts';
import { handleAsyncOperation, handleSyncOperation } from '@/lib/helpers.ts';
import { passwordSchema, usernameSchema } from '@/validation/validation.ts';

export enum Platform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
}

export const authSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  platform: z.enum(Platform),
});

export function authRoutes(server: FastifyInstance) {
  const { redisService } = server;

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
            () => redisService.getUser(username),
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
            () =>
              redisService.createUser(username, `${salt}:${hashedPassword}`),
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
          const { username, password, platform } = request.body;

          // Check rate limiting
          const canAttempt = await redisService.checkRateLimit(username);
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
            () => redisService.getUser(username),
            'Failed to retrieve user data',
            ErrorCode.DATABASE_ERROR,
          );

          if (!user) {
            await redisService.incrementLoginAttempts(username);
            throw createAuthError('Invalid credentials');
          }

          // Parse stored password
          const [salt, key] = user.split(':');
          if (!salt || !key) {
            await redisService.incrementLoginAttempts(username);
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
            await redisService.clearLoginAttempts(username);

            // Set session (synchronous operation)
            handleSyncOperation(
              () => {
                request.session.set('username', username);
                request.session.set('platform', platform);
              },
              'Failed to create session',
              ErrorCode.SESSION_ERROR,
            );

            reply.code(200).send(username);
          } else {
            await redisService.incrementLoginAttempts(username);
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
  server.post(
    '/logout',
    {
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      try {
        const { username, platform } = request;

        // Delete push token if exists
        if (platform === Platform.ANDROID) {
          await handleAsyncOperation(
            () => redisService.deletePushToken(username),
            'Failed to delete push token',
            ErrorCode.DATABASE_ERROR,
          ).catch(() => {
            // Ignore errors if push token doesn't exist
          });
        }

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
    },
  );

  // Get current user endpoint (validates session)
  server.post(
    '/me',
    {
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      try {
        // If we get here, session is valid (authenticate middleware passed)
        reply.code(200).send({ username: request.username });
      } catch (error) {
        const response = handleError(error, server);
        reply.code(500).send(response);
      }
    },
  );

  // Store push token endpoint (Android only)
  server.withTypeProvider<ZodTypeProvider>().post(
    '/push-token',
    {
      preHandler: [server.authenticate],
      schema: {
        body: z.object({
          token: z.string().min(1, 'Push token is required'),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { token } = request.body;
        const { username, platform } = request;

        if (platform !== Platform.ANDROID) {
          reply.code(200).send({
            success: false,
            message: 'Push tokens only supported for Android',
          });
          return;
        }

        await handleAsyncOperation(
          () => redisService.setPushToken(username, token),
          'Failed to store push token',
          ErrorCode.DATABASE_ERROR,
        );

        reply.code(200).send({ success: true });
      } catch (error) {
        const response = handleError(error, server);
        reply.code(500).send(response);
      }
    },
  );
}
