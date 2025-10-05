import { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '@/theme/theme';

export default function FormContainer({ children }: PropsWithChildren) {
  return <View style={styles.formContainer}>{children}</View>;
}

const styles = StyleSheet.create({
  formContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 300,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 25,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
  },
});
