import { StyleSheet, View } from 'react-native';

import CenteredContainer from '@/components/common/CenteredContainer';
import RegisterForm from '@/components/forms/RegisterForm';
import { DocumentTitle } from '@/misc/DocumentTitle';
import { theme } from '@/theme/theme';

export default function RegisterScreen() {
  return (
    <View style={styles.container}>
      <DocumentTitle title="Register" />
      <CenteredContainer>
        <RegisterForm />
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
