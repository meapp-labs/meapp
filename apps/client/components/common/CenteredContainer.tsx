import type { PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'

export function CenteredContainer({ children }: PropsWithChildren) {
  return <View style={styles.container}>{children}</View>
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
