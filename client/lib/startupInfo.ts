import Constants from 'expo-constants';
import { Platform } from 'react-native';

interface StartupInfo {
  appVersion: string;
  expoVersion: string;
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
    appVersion: manifest?.version || nativeAppVersion || 'unknown',
    expoVersion:
      Constants.expoConfig?.sdkVersion ||
      (Constants.expoVersion as string | undefined) ||
      'unknown',
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
  console.log('🚀 MeApp Starting Up');
  console.log(`📦 App Version:      ${info.appVersion}`);
  console.log(`🔧 Expo Version:     ${info.expoVersion}`);
  console.log(
    `📱 Platform:         ${info.platform} (v${info.platformVersion})`,
  );
  console.log(`💻 Device:           ${info.deviceName}`);
  console.log(`🐛 Debug Mode:       ${info.isDebug ? 'Yes' : 'No'}`);
  console.log(`🌍 Environment:      ${info.nodeEnv}`);
  console.log(`📋 Bundle ID:        ${info.bundleId}`);
}
