import Constants from 'expo-constants'
import { Platform } from 'react-native'

import { env } from '@/lib/env'

/** Single-line startup log with the fields that matter for debugging. */
export function logStartupInfo(): void {
  const manifest = Constants.expoConfig
  const nativeAppVersion = (Constants as unknown as { nativeAppVersion?: string }).nativeAppVersion

  console.log(
    `[meapp] v${manifest?.version || nativeAppVersion || '?'} | ${Platform.OS} ${String(Platform.Version)} | ${__DEV__ ? 'dev' : 'prod'} | api=${env.EXPO_PUBLIC_API_URL}`,
  )
}
