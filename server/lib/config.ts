import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('127.0.0.1'),
    EXTERNAL_IP: z.string().optional(),
    REDIS_HOST: z.string().default('127.0.0.1'),
    REDIS_PORT: z.coerce.number().default(6379),
    SESSION_SECRET: z.string().min(32),
    SESSION_SALT: z.string(),
});

export const env = envSchema.parse(process.env);

// Login configuration constants
export const LOGIN_CONFIG = {
    SCRYPT_KEY_LENGTH: 64,
    SALT_LENGTH: 16,
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
    MESSAGE_EXPIRY: 24 * 60 * 60, // 24 hours in seconds
} as const;
