const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export const isProduction = process.env.NODE_ENV === 'production'

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: int(process.env.PORT, 3000),
  HOST: process.env.HOST ?? '127.0.0.1',
  DOMAIN: process.env.DOMAIN,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  WS_TICKET_SECRET: process.env.WS_TICKET_SECRET,
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
