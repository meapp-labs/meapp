import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewProps } from 'react-native'

import { theme } from '@/theme/theme'

export function FormContainer({ children, style, ...props }: ViewProps) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'padding' : 'height'}
      keyboardVerticalOffset={50}
      style={{ width: '100%', maxWidth: 480 }}
    >
      <View {...props} style={[styles.container, style]}>
        {children}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.lg,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    backgroundColor: theme.colors.backgroundSecondary,
  },
})
