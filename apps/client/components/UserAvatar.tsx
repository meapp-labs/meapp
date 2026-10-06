import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Image } from 'expo-image'
import { useState } from 'react'
import { View } from 'react-native'

import { theme } from '@/theme/theme'

export function UserAvatar({
  uri,
  size = 48,
  label = 'Avatar',
}: { uri?: string | null | undefined; size?: number; label?: string | undefined }) {
  const [failedUri, setFailedUri] = useState<string | null>(null)
  return uri && failedUri !== uri ? (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={uri}
      accessibilityLabel={label}
      onError={() => setFailedUri(uri)}
    />
  ) : (
    <View accessibilityLabel={label}>
      <MaterialIcons name="face-5" size={size} color={theme.colors.text} />
    </View>
  )
}
