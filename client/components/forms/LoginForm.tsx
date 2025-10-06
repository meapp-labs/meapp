import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableHighlight,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

import Button from '@/components/common/Button';
import { Text } from '@/components/common/Text';
import { FormContainer } from '@/components/forms/FormContainer';
import { FormField } from '@/components/forms/FormInput';
import { extractErrorMessage } from '@/lib/axios';
import { useAuthStore } from '@/lib/stores';
import { useLoginUser } from '@/services/auth';
import { theme } from '@/theme/theme';
import { LoginSchema, LoginType } from '@/validation/userValidation';

export default function LoginForm() {
  const setUsername = useAuthStore((state) => state.setUsername);
  const { mutate, isPending } = useLoginUser();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginType>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = handleSubmit((data: LoginType) => {
    mutate(data, {
      onSuccess: () => {
        setUsername(data.username);
        router.replace('/');
      },
      onError(error) {
        Toast.show({
          type: 'error',
          text1: 'Login Failed',
          text2: extractErrorMessage(error),
        });
      },
    });
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'padding' : 'height'}
      keyboardVerticalOffset={20}
    >
      <FormContainer>
        <Text style={styles.header}>Login to your account</Text>

        <View style={{ flexDirection: 'row' }}>
          <Text>Don&apos;t have an account? </Text>
          <TouchableHighlight onPress={() => router.replace('/register')}>
            <Text style={{ color: theme.colors.secondary }}>Sign up</Text>
          </TouchableHighlight>
        </View>

        <View style={styles.inputContainer}>
          <FormField
            control={control}
            name="username"
            label="Username"
            placeholder="Enter username"
            error={errors.username}
            editable={!isPending}
            onSubmitEditing={() => {
              void onSubmit();
            }}
          />

          <FormField
            control={control}
            name="password"
            label="Password"
            placeholder="Enter password"
            error={errors.password}
            isPassword
            editable={!isPending}
            onSubmitEditing={() => {
              void onSubmit();
            }}
          />
        </View>
        <Button
          title="Login"
          onPress={() => {
            void onSubmit();
          }}
          loading={isPending}
          variant="primary"
          size="small"
        />
      </FormContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    ...theme.typography.h1,
    fontWeight: 'bold',
  },
  inputContainer: {
    marginTop: theme.spacing.md,
    rowGap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
});
