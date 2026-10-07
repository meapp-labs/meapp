import { BaseToast, type BaseToastProps, ErrorToast, InfoToast } from 'react-native-toast-message'

import { theme } from '@/theme/theme'

export const toastConfig = {
  success: (props: BaseToastProps) => (
    <BaseToast
      {...props}
      style={{
        width: '90%',
        maxWidth: 420,
        minHeight: 72,
        height: 'auto',
        borderRadius: 14,
        borderLeftColor: theme.colors.primary,
        backgroundColor: theme.colors.card,
        borderLeftWidth: 5,
      }}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.md,
      }}
      text1Style={{
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
      }}
      text2Style={{
        fontSize: 14,
        color: theme.colors.textSecondary,
      }}
      text2NumberOfLines={3}
    />
  ),

  error: (props: BaseToastProps) => (
    <ErrorToast
      {...props}
      style={{
        width: '90%',
        maxWidth: 420,
        minHeight: 72,
        height: 'auto',
        borderRadius: 14,
        borderLeftColor: theme.colors.error,
        backgroundColor: theme.colors.card,
        borderLeftWidth: 5,
      }}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.md,
      }}
      text1Style={{
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
      }}
      text2Style={{
        fontSize: 14,
        color: theme.colors.textSecondary,
      }}
      text2NumberOfLines={3}
    />
  ),

  info: (props: BaseToastProps) => (
    <InfoToast
      {...props}
      style={{
        width: '90%',
        maxWidth: 420,
        minHeight: 72,
        height: 'auto',
        borderRadius: 14,
        borderLeftColor: theme.colors.secondary,
        backgroundColor: theme.colors.card,
        borderLeftWidth: 5,
      }}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.md,
      }}
      text1Style={{
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
      }}
      text2Style={{
        fontSize: 14,
        color: theme.colors.textSecondary,
      }}
      text2NumberOfLines={3}
    />
  ),
}
