
export default {
    expo: {
        name: 'meapp',
        slug: 'meapp',
        version: '1.0.0',
        orientation: 'portrait',
        icon: './images/icon.png',
        scheme: 'meapp',
        userInterfaceStyle: 'automatic',
        backgroundColor: '#000000',
        assetBundlePatterns: ['assets/images/*'],
        newArchEnabled: true,
        ios: {
            supportsTablet: true,
        },
        android: {
            adaptiveIcon: {
                foregroundImage: './images/adaptive-icon.png',
                backgroundColor: '#000000',
            },
            edgeToEdgeEnabled: true,
            permissions: [],
            package: 'com.anonymous.meapp',
        },
        web: {
            bundler: 'metro',
            output: 'static',
            favicon: './images/favicon.png',
            meta:{
                themeColor:"#121212",
                //appleMobileWebAppStatusBarStyle: "black-translucent"
            }
        },
        plugins: [
            'expo-router',
            [
                'expo-splash-screen',
                {
                    image: './images/splash-icon.png',
                    imageWidth: 200,
                    resizeMode: 'contain',
                    backgroundColor: '#000000',
                },
            ],
            'expo-font',
        ],
        experiments: {
            typedRoutes: true,
        },
    },
};
