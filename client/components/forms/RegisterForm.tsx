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
import { useRegisterUser } from '@/services/auth';
import { theme } from '@/theme/theme';
import { RegisterSchema, RegisterType } from '@/validation/userValidation';

export default function RegisterForm() {
  const { mutate, isPending } = useRegisterUser();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterType>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = handleSubmit((data: RegisterType) =>
    mutate(data, {
      onSuccess: () => router.replace('/login'),
      onError(error) {
        Toast.show({
          type: 'error',
          text1: 'Registration Failed',
          text2: extractErrorMessage(error),
        });
      },
    }),
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'padding' : 'height'}
      keyboardVerticalOffset={20}
    >
      <FormContainer>
        <Text style={styles.header}>Create a new account</Text>

        <View style={{ flexDirection: 'row' }}>
          <Text>Already have an account? </Text>
          <TouchableHighlight onPress={() => router.replace('/login')}>
            <Text style={{ color: theme.colors.secondary }}>Sign in</Text>
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
            name="email"
            label="Email"
            placeholder="Enter email"
            error={errors.email}
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

          <FormField
            control={control}
            name="confirmPassword"
            label="Confirm Password"
            placeholder="Confirm password"
            error={errors.confirmPassword}
            isPassword
            editable={!isPending}
            onSubmitEditing={() => {
              void onSubmit();
            }}
          />

          <Button
            title="Register"
            onPress={() => {
              void onSubmit();
            }}
            loading={isPending}
            variant="primary"
            size="small"
          />
        </View>
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
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.caption,
  },
});
