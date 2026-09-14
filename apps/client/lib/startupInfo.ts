import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { env } from '@/lib/env';

interface StartupInfo {
  appName: string;
  appVersion: string;
  expoVersion: string;
  apiUrl: string;
  platform: string;
  platformVersion: string;
  deviceName: string;
  isDebug: boolean;
  nodeEnv: string;
  bundleId: string;
}

/**
 * Get comprehensive startup information about the app
 */
export function getStartupInfo(): StartupInfo {
  const manifest = Constants.expoConfig;
  const nativeAppVersion = Constants['nativeAppVersion'] as string | undefined;

  return {
    appName: Constants.expoConfig?.name || 'unknown',
    appVersion: manifest?.version || nativeAppVersion || 'unknown',
    expoVersion:
      Constants.expoConfig?.sdkVersion ||
      (Constants.expoVersion as string | undefined) ||
      'unknown',
    apiUrl: env.EXPO_PUBLIC_API_URL,
    platform: Platform.OS,
    platformVersion: String(Platform.Version),
    deviceName: Constants.deviceName || 'unknown',
    isDebug: __DEV__,
    nodeEnv: process.env.NODE_ENV || 'unknown',
    bundleId:
      Platform.OS === 'ios'
        ? Constants.expoConfig?.ios?.bundleIdentifier || 'unknown'
        : Platform.OS === 'android'
          ? Constants.expoConfig?.android?.package || 'unknown'
          : 'web',
  };
}

/**
 * Log startup information to console in a formatted way
 */
export function logStartupInfo(): void {
  const info = getStartupInfo();
  console.log(`🚀 ${info.appName} Starting Up`);
  console.log(`📦 App Version:      ${info.appVersion}`);
  console.log(`🔧 Expo Version:     ${info.expoVersion}`);
  console.log(`🕸 API URL:           ${info.apiUrl}`);
  console.log(
    `📱 Platform:          ${info.platform} (v${info.platformVersion})`,
  );
  console.log(`💻 Device:           ${info.deviceName}`);
  console.log(`🐛 Debug Mode:       ${info.isDebug ? 'Yes' : 'No'}`);
  console.log(`🌍 Environment:      ${info.nodeEnv}`);
  console.log(`📋 Bundle ID:        ${info.bundleId}`);
}
