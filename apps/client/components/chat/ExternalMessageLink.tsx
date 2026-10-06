import { Text } from '@/components/common/Text'
import { theme } from '@/theme/theme'
import type { ReactNode } from 'react'
import { Linking, Pressable } from 'react-native'
import Toast from 'react-native-toast-message'

export type ExternalMessageLinkProps = {
  url: string
  standalone?: boolean
  children: ReactNode
}

export function ExternalMessageLink({ url, standalone, children }: ExternalMessageLinkProps) {
  const open = () => {
    void Linking.openURL(url).catch(() => {
      Toast.show({ type: 'error', text1: 'Unable to open link', text2: 'Please try again' })
    })
  }
  return standalone ? (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${url}`} onPress={open}>
      {children}
    </Pressable>
  ) : (
    <Text
      accessibilityRole="link"
      accessibilityLabel={`Open ${url}`}
      onPress={open}
      style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
    >
      {children}
    </Text>
  )
}
