import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Control,
  Controller,
  FieldError,
  FieldValues,
  Path,
} from 'react-hook-form';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';

// Auto-detect textContentType (iOS) from field name
const getContentType = (name: string): TextInputProps['textContentType'] => {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('email')) return 'emailAddress';
  if (nameLower.includes('username')) return 'username';
  if (nameLower === 'password') return 'password';
  if (
    nameLower.includes('newpassword') ||
    nameLower.includes('confirmpassword')
  )
    return 'newPassword';
  return 'none';
};

// Auto-detect autoComplete (Android/cross-platform) from field name
const getAutoComplete = (name: string): TextInputProps['autoComplete'] => {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('email')) return 'email';
  if (nameLower.includes('username')) return 'username';
  if (nameLower === 'password') return 'current-password';
  if (
    nameLower.includes('newpassword') ||
    nameLower.includes('confirmpassword')
  )
    return 'new-password';
  return 'off';
};

interface FormFieldProps<T extends FieldValues>
  extends Omit<TextInputProps, 'value' | 'onChangeText' | 'onBlur'> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  error?: FieldError | undefined;
  isPassword?: boolean;
}

export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  error,
  isPassword = false,
  textContentType,
  autoComplete,
  ...inputProps
}: FormFieldProps<T>) {
  const [showPassword, setShowPassword] = useState(false);

  // Auto-detect if not manually provided
  const contentType = textContentType ?? getContentType(name as string);
  const autoCompleteType = autoComplete ?? getAutoComplete(name as string);

  return (
    <View>
      <View style={styles.labelContainer}>
        <Text>{label}</Text>
        {isPassword && (
          <Pressable
            accessible={false}
            tabIndex={-1}
            onPress={() => setShowPassword(!showPassword)}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color="white"
              style={styles.icon}
            />
          </Pressable>
        )}
      </View>

      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange, onBlur } }) => (
          <TextInput
            {...inputProps}
            style={[styles.input, error && styles.inputError, inputProps.style]}
            secureTextEntry={isPassword && !showPassword}
            placeholderTextColor={theme.colors.textSecondary}
            textContentType={contentType}
            autoComplete={autoCompleteType}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
          />
        )}
      />

      {error && <Text style={styles.errorText}>{error.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: theme.spacing.lg,
  },
  icon: {
    marginLeft: theme.spacing.sm,
  },
  input: {
    borderColor: theme.colors.borderSecondary,
    padding: Platform.OS === 'android' ? theme.spacing.md : theme.spacing.sm,
    borderWidth: 1,
    borderRadius: theme.spacing.xs,
    color: theme.colors.text,
  },
  inputError: {
    borderColor: theme.colors.error,
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.caption,
  },
});
