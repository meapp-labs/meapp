import Constants from 'expo-constants'
import { z } from 'zod'

const rawEnv = {
  // Expo substitutes public variables only when accessed through literal properties.
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_ENV: process.env.EXPO_PUBLIC_ENV,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  ...(Constants.expoConfig?.extra ?? {}),
}

const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url().default('http://127.0.0.1:3000'),
  EXPO_PUBLIC_ENV: z.enum(['development', 'preview', 'production']).default('development'),
  EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>

export const env = envSchema.parse(rawEnv)

// Fail the build if a production bundle would talk cleartext HTTP.
if (
  (process.env.APP_VARIANT === 'production' ||
    Constants.expoConfig?.extra?.appVariant === 'production') &&
  !env.EXPO_PUBLIC_API_URL.startsWith('https://')
) {
  throw new Error(
    `Production build requires an https EXPO_PUBLIC_API_URL, got: ${env.EXPO_PUBLIC_API_URL}. Set EXPO_PUBLIC_API_URL in the production EAS profile.`,
  )
}
