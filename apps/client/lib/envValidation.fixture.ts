import { mock } from 'bun:test'

mock.module('expo-constants', () => ({
  default: { expoConfig: { extra: { appVariant: process.env.MEAPP_TEST_APP_VARIANT } } },
}))
try {
  const { env } = await import('./env')
  console.log(JSON.stringify(env))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
