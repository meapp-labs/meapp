import { z } from 'zod'

export const isProduction = process.env.NODE_ENV === 'production'

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z
      .string()
      .regex(/^([0-9]{1,3}\.){3}[0-9]{1,3}$|^[a-zA-Z0-9.-]+$/)
      .default('127.0.0.1'),
    DOMAIN: z.string().optional(),
    DATABASE_URL: z.string().default('./data/data.db'),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    JWT_SECRET: z.string().default('dev-secret-change-me'),
    WS_TICKET_SECRET: z.string().optional(),
    MAX_UNAUTH_GLOBAL: z.coerce.number().default(100),
    MAX_UNAUTH_PER_IP: z.coerce.number().default(10),
    MAX_WS_CONNS_PER_USER: z.coerce.number().default(3),
    MAX_ROOM_SUBS_PER_USER: z.coerce.number().default(10),
    UNAUTH_TIMEOUT_MS: z.coerce.number().default(2000),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (!data.JWT_SECRET || data.JWT_SECRET === 'dev-secret-change-me') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT_SECRET is required and cannot use dev fallback in production',
          path: ['JWT_SECRET'],
        })
      }
      if (!data.WS_TICKET_SECRET || data.WS_TICKET_SECRET === 'dev-secret-change-me') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WS_TICKET_SECRET is required and cannot use dev fallback in production',
          path: ['WS_TICKET_SECRET'],
        })
      }
    }
  })

const parsedEnv = serverEnvSchema.safeParse(process.env)

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format())
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`)
}

export const env = parsedEnv.data

export const WS_CONFIG = {
  MAX_UNAUTH_GLOBAL: env.MAX_UNAUTH_GLOBAL,
  MAX_UNAUTH_PER_IP: env.MAX_UNAUTH_PER_IP,
  MAX_WS_CONNS_PER_USER: env.MAX_WS_CONNS_PER_USER,
  MAX_ROOM_SUBS_PER_USER: env.MAX_ROOM_SUBS_PER_USER,
  UNAUTH_TIMEOUT_MS: env.UNAUTH_TIMEOUT_MS,
} as const

export const SESSION_COOKIE_NAME = 'access_token'

/** Login/session policy, carried over from the Fastify implementation. */
export const LOGIN_CONFIG = {
  SCRYPT_KEY_LENGTH: 64,
  SALT_LENGTH: 16,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000,
  SESSION_TTL_SECONDS: 30 * 24 * 60 * 60,
} as const
