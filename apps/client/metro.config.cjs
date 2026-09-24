const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'zustand/middleware') {
    // Zustand's react-native export is compatible with Metro's script bundle.
    return context.resolveRequest(
      {
        ...context,
        unstable_conditionsByPlatform: {
          ...context.unstable_conditionsByPlatform,
          web: [...(context.unstable_conditionsByPlatform.web ?? []), 'react-native'],
        },
      },
      moduleName,
      platform,
    )
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
