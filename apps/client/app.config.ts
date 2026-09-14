const IS_PROD = process.env['APP_VARIANT'] === 'production';

const config = IS_PROD
  ? { packageName: 'com.meapp', appName: 'MeApp' }
  : { packageName: 'com.meapp.dev', appName: 'MeApp (dev)' };

export default {
  expo: {
    name: config.appName,
    description: 'Messaging app',
    slug: 'meapp',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icons/icon.png',
    scheme: 'meapp',
    platform: ['android', 'web'],
    userInterfaceStyle: 'dark',
    backgroundColor: '#000000',
    primaryColor: '#F5BA30',
    assetBundlePatterns: ['assets/*'],
    newArchEnabled: true,
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/icons/icon.png',
        backgroundColor: '#000000',
      },
      edgeToEdgeEnabled: true,
      permissions: ['android.permission.POST_NOTIFICATIONS'],
      package: config.packageName,
      googleServicesFile: './config/google-services.json',
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/icons/favicon.png',
      name: config.appName,
    },
    extra: {
      eas: {
        projectId: 'afa26b45-ae5f-4382-99ec-43c30d6fcab2',
      },
    },
    plugins: [
      'expo-notifications',
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
      'expo-router',
      [
        'expo-splash-screen',
        {
          image: './assets/icons/icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#000000',
        },
      ],
      'expo-font',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
