import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CenteredContainer from '@/components/common/CenteredContainer';
import RegisterForm from '@/components/forms/RegisterForm';
import { DocumentTitle } from '@/misc/DocumentTitle';
import { theme } from '@/theme/theme';

export default function RegisterScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Register" />
      <CenteredContainer>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? 'padding' : 'height'}
          keyboardVerticalOffset={20}
        >
          <RegisterForm />
        </KeyboardAvoidingView>
      </CenteredContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    flexGrow: 1,
  },
});
