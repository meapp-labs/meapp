import { StyleSheet, View, ViewProps } from 'react-native';

import { theme } from '@/theme/theme';

export function FormContainer({ children, style, ...props }: ViewProps) {
  return (
    <View {...props} style={[styles.container, styles.shadow, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.secondary,
    backgroundColor: theme.colors.background,
  },
  shadow: {
    shadowColor: theme.colors.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 15,
  },
});
