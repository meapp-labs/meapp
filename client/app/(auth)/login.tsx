import { StyleSheet, View } from 'react-native';

import CenteredContainer from '@/components/common/CenteredContainer';
import LoginForm from '@/components/forms/LoginForm';
import { DocumentTitle } from '@/misc/DocumentTitle';
import { theme } from '@/theme/theme';

export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <DocumentTitle title="Login" />
      <CenteredContainer>
        <LoginForm />
      </CenteredContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    flexGrow: 1,
  },
});
