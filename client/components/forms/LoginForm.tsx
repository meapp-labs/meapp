import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  TouchableHighlight,
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { theme } from '@/theme/theme';
import { Text } from '../common/Text';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { useAuthStore } from '@/lib/stores';
import { LoginType, LoginSchema } from '@/validation/userValidation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';
import { useLoginUser } from '@/services/auth';

export default function LoginForm() {
  const [isVisible, setVisible] = useState(false);
  const setUsername = useAuthStore((state) => state.setUsername);

  const registerRoute = () => {
    router.replace('/register');
  };

  const { mutate, isError, isPending, error } = useLoginUser();

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
    });
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'padding' : 'height'}
      keyboardVerticalOffset={20}
    >
      {isPending && (
        <Text style={{ marginBottom: theme.spacing.md }}>Loading...</Text>
      )}
      {isError && (
        <Text style={{ marginBottom: theme.spacing.md }}>
          error: {error.message}
        </Text>
      )}

      <View style={[styles.formContainer, styles.shadow]}>
        <Text style={styles.header}>Login to your account</Text>
        <View style={{ flexDirection: 'row' }}>
          <Text>Don&apos;t have an account? </Text>
          <TouchableHighlight onPress={registerRoute}>
            <Text style={{ color: theme.colors.secondary }}>Sign up</Text>
          </TouchableHighlight>
        </View>
        <View style={styles.inputContainer}>
          <View style={styles.captionContainer}>
            <Text>Username</Text>
          </View>
          <Controller
            control={control}
            name="username"
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                onSubmitEditing={onSubmit}
                style={[
                  styles.formInput,
                  errors.username && {
                    borderColor: theme.colors.error,
                  },
                ]}
                placeholder="Enter username"
                placeholderTextColor={theme.colors.textSecondary}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
              />
            )}
          />
          {errors.username && (
            <Text style={styles.errorText}>{errors.username.message}</Text>
          )}
          <View style={styles.captionContainer}>
            <Text>Password</Text>
            <Pressable
              style={styles.icon}
              onPress={() => setVisible((prev) => !prev)}
            >
              <Ionicons
                name={isVisible ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color="white"
              />
            </Pressable>
          </View>
          <Controller
            control={control}
            name="password"
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                onSubmitEditing={onSubmit}
                secureTextEntry={!isVisible}
                style={[
                  styles.formInput,
                  errors.password && {
                    borderColor: theme.colors.error,
                  },
                ]}
                placeholder="Enter password"
                placeholderTextColor={theme.colors.textSecondary}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
              />
            )}
          />
          {errors.password && (
            <Text style={styles.errorText}>{errors.password.message}</Text>
          )}
          <TouchableOpacity style={styles.submitButton} onPress={onSubmit}>
            <Text style={{ color: 'black', fontWeight: 'bold' }}>Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  formContainer: {
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.secondary,
    backgroundColor: theme.colors.background,
  },
  submitButton: {
    marginTop: theme.spacing.sm,
    padding: Platform.OS === 'android' ? theme.spacing.md : theme.spacing.sm,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.spacing.xs,
    alignItems: 'center',
  },
  formInput: {
    borderColor: theme.colors.borderSecondary,
    padding: Platform.OS === 'android' ? theme.spacing.md : theme.spacing.sm,
    borderWidth: 1,
    borderRadius: theme.spacing.xs,
    color: theme.colors.text,
  },
  header: {
    ...theme.typography.h1,
    fontWeight: 'bold',
  },
  inputContainer: {
    marginTop: theme.spacing.md,
    rowGap: theme.spacing.sm,
  },
  shadow: {
    //ios
    shadowColor: theme.colors.secondary,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    //android
    elevation: 15,
  },
  icon: {
    marginLeft: theme.spacing.sm,
  },
  captionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: theme.spacing.lg,
  },
  errorText: {
    textAlign: 'left',
    color: theme.colors.error,
    ...theme.typography.caption,
  },
});
