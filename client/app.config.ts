export default {
  expo: {
    name: 'meapp',
    slug: 'meapp',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icons/icon.png',
    scheme: 'meapp',
    userInterfaceStyle: 'automatic',
    backgroundColor: '#000000',
    assetBundlePatterns: ['assets/*'],
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/icons/icon.png',
        backgroundColor: '#000000',
      },
      edgeToEdgeEnabled: true,
      permissions: ['android.permission.POST_NOTIFICATIONS'],
      package: 'com.meapp',
      googleServicesFile: './config/google-services.json',
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/icons/favicon.png',
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
