import { MaterialIcons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, TouchableHighlight, View } from 'react-native';
import Toast from 'react-native-toast-message';

import Button from '@/components/common/Button';
import { Text } from '@/components/common/Text';
import { FormContainer } from '@/components/forms/FormContainer';
import { FormField } from '@/components/forms/FormInput';
import { extractErrorMessage } from '@/lib/axios';
import { useAuthStore } from '@/lib/stores';
import { useLoginUser } from '@/services/auth';
import { RememberMeStorage } from '@/services/storage';
import { theme } from '@/theme/theme';
import { LoginSchema, LoginType } from '@/validation/userValidation';

export default function LoginForm() {
  const setUsername = useAuthStore((state) => state.setUsername);
  const { mutate, isPending } = useLoginUser();
  const [rememberMe, setRememberMe] = useState(false);

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

        if (rememberMe) {
          void RememberMeStorage.save();
        } else {
          void RememberMeStorage.clear();
        }

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
        <View style={styles.container}>
          <Pressable
            style={styles.rememberMe}
            onPress={() => setRememberMe(!rememberMe)}
          >
            <MaterialIcons
              name={rememberMe ? 'check-box' : 'check-box-outline-blank'}
              size={16}
              color={rememberMe ? theme.colors.text : theme.colors.border}
            />
            <Text selectable={false}>Remember me</Text>
          </Pressable>
          <Pressable>
            <Text
              selectable={false}
              onPress={() =>
                Toast.show({
                  type: 'info',
                  text1: 'Too bad 🤷‍♂️',
                  text2: 'Recovery not yet implemented',
                })
              }
            >
              Forgot password?
            </Text>
          </Pressable>
        </View>
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
  );
}

const styles = StyleSheet.create({
  header: {
    ...theme.typography.h1,
    fontWeight: 'bold',
  },
  inputContainer: {
    marginVertical: theme.spacing.md,
    rowGap: theme.spacing.sm,
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
  },
  rememberMe: {
    gap: theme.spacing.xs,
    flexDirection: 'row',
  },
});
