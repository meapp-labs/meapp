import Constants from 'expo-constants'
import { z } from 'zod'

const rawEnv = {
  ...process.env,
  ...(Constants.expoConfig?.extra ?? {}),
}

const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url().default('http://127.0.0.1:3000'),
  EXPO_PUBLIC_ENV: z.enum(['development', 'preview', 'production']).default('development'),
  EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>

export const env = envSchema.parse(rawEnv)
