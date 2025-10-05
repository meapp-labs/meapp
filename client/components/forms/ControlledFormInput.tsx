import { Controller, Control, FieldErrors } from 'react-hook-form';
import { View, StyleSheet, TextInputProps } from 'react-native';
import { Text } from '../common/Text';
import { theme } from '@/theme/theme';
import FormTextInput from './FormTextInput';

interface ControlledFormInputProps extends TextInputProps {
  control: Control<any>;
  name: string;
  placeholder: string;
  errors: FieldErrors;
}

export default function ControlledFormInput({
  control,
  name,
  placeholder,
  errors,
  ...textInputProps
}: ControlledFormInputProps) {
  const error = errors[name];

  return (
    <View>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextInput
            placeholder={placeholder}
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
            error={!!error}
            {...textInputProps}
          />
        )}
      />
      <View style={styles.errorContainer}>
        {error && (
          <Text style={styles.errorText}>{error.message as string}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    height: 40,
    width: 250,
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  errorText: {
    color: theme.colors.error,
    marginLeft: theme.spacing.md,
  },
});
