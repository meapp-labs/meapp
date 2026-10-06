import type { ReactNode } from 'react'
import { View } from 'react-native'

export function MediaDropZone({ children }: { conversationId: string; children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>
}
