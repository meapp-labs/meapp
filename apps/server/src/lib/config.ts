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
    WS_TICKET_SECRET: z.string().optional().default('dev-ws-ticket-secret-change-me'),
    MAX_UNAUTH_GLOBAL: z.coerce.number().default(100),
    MAX_UNAUTH_PER_IP: z.coerce.number().default(10),
    MAX_WS_CONNS_PER_USER: z.coerce.number().default(3),
    MAX_ROOM_SUBS_PER_USER: z.coerce.number().default(10),
    UNAUTH_TIMEOUT_MS: z.coerce.number().default(2000),
    E2E_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v === 'true' || v === '1'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (!data.E2E_ENABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'E2E must be enabled in production',
          path: ['E2E_ENABLED'],
        })
      }
      if (!data.JWT_SECRET || data.JWT_SECRET === 'dev-secret-change-me') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT_SECRET is required and cannot use dev fallback in production',
          path: ['JWT_SECRET'],
        })
      }
      if (!data.WS_TICKET_SECRET || data.WS_TICKET_SECRET === 'dev-ws-ticket-secret-change-me') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WS_TICKET_SECRET is required and must differ from JWT_SECRET in production',
          path: ['WS_TICKET_SECRET'],
        })
      }
      if (data.WS_TICKET_SECRET === data.JWT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WS_TICKET_SECRET must not equal JWT_SECRET',
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

/** Live read so the flag can be toggled without a process restart (also testable). */
export const isE2EEnabled = (): boolean =>
  isProduction || (process.env.E2E_ENABLED !== 'false' && process.env.E2E_ENABLED !== '0')

export const SESSION_COOKIE_NAME = 'access_token'

/** Login/session policy, carried over from the Fastify implementation. */
export const LOGIN_CONFIG = {
  SCRYPT_KEY_LENGTH: 64,
  SALT_LENGTH: 16,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000,
  SESSION_TTL_SECONDS: 30 * 24 * 60 * 60,
} as const

/** E2E (Signal protocol relay) limits — see MEAPP-PHASE-10-IMPROVED.md §10.9. */
export const E2E_CONFIG = {
  /** base64 ciphertext cap: ~8KB plaintext → ~11KB base64. */
  CIPHERTEXT_MAX: 12 * 1024,
  MAX_PREKEYS_PER_UPLOAD: 150,
  MIN_PREKEYS_PER_UPLOAD: 100,
  /** Signed prekey must not be valid longer than 30 days. */
  SIGNED_PREKEY_MAX_TTL_MS: 30 * 24 * 60 * 60 * 1000,
} as const
