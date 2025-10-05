import { theme } from '@/theme/theme';
import { TextInput, StyleSheet, TextInputProps } from 'react-native';

interface FormInputProps extends TextInputProps {
    error?: boolean;
}

export default function FormTextInput(props: FormInputProps) {
    const { style, error, ...otherProps } = props;

    return (
        <TextInput
            style={[styles.input, style, error && styles.errorInput]}
            placeholderTextColor={theme.colors.textSecondary}
            {...otherProps}
        />
    );
}

const styles = StyleSheet.create({
    input: {
        width: 250,
        color: theme.colors.text,
        padding: theme.spacing.md,
        backgroundColor: theme.colors.card,
        borderColor: theme.colors.border,
        borderRadius: 15,
        borderWidth: 1,
    },
    errorInput: {
        borderColor: theme.colors.error,
        borderWidth: 1,
    },
});
