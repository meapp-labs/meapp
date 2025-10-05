import CenteredContainer from '@/components/common/CenteredContainer';
import RegisterForm from '@/components/forms/RegisterForm';
import { View, StyleSheet } from 'react-native';
import { theme } from '@/theme/theme';

export default function RegisterScreen() {
  return (
    <View style={styles.container}>
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
