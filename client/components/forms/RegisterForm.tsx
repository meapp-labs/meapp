import {
    Platform,
    Pressable,
    TextInput,
    TouchableHighlight,
    View,
    StyleSheet,
    TouchableOpacity,
    KeyboardAvoidingView,
    ActivityIndicator,
} from 'react-native';
import { theme } from '@/theme/theme';
import { Text } from '@/components/common/Text';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { useRegisterUser } from '@/services/auth';
import { RegisterType, RegisterSchema } from '@/validation/userValidation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { extractErrorMessage } from '@/lib/axios';

export default function RegisterForm() {
    const registerRoute = () => {
        router.replace('/login');
    };
    const [isVisible, setVisible] = useState(false);

    const { mutate, isError, isPending, error } = useRegisterUser(() =>
        router.replace('/login'),
    );

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

    const onSubmit = handleSubmit((data: RegisterType) => {
        console.log(data);
        mutate(data);
    });

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'android' ? 'padding' : 'height'}
            keyboardVerticalOffset={20}
        >
            <View style={[styles.formContainer, styles.shadow]}>
                {isError && (
                    <Text style={styles.errorText}>
                        {extractErrorMessage(error)}
                    </Text>
                )}

                <Text style={styles.header}>Create a new account</Text>
                <View style={{ flexDirection: 'row' }}>
                    <Text>Already have an account? </Text>
                    <TouchableHighlight onPress={registerRoute}>
                        <Text style={{ color: theme.colors.secondary }}>
                            Sign in
                        </Text>
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
                                style={[
                                    styles.formInput,
                                    errors.username && {
                                        borderColor: theme.colors.error,
                                    },
                                ]}
                                autoComplete="off"
                                textContentType="none"
                                placeholder="Enter username"
                                placeholderTextColor={
                                    theme.colors.textSecondary
                                }
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                editable={!isPending}
                                onSubmitEditing={onSubmit}
                            />
                        )}
                    />
                    {errors.username && (
                        <Text style={styles.errorText}>
                            {errors.username.message}
                        </Text>
                    )}
                    <View style={styles.captionContainer}>
                        <Text>Email</Text>
                    </View>
                    <Controller
                        control={control}
                        name="email"
                        render={({ field: { value, onChange, onBlur } }) => (
                            <TextInput
                                style={[
                                    styles.formInput,
                                    errors.email && {
                                        borderColor: theme.colors.error,
                                    },
                                ]}
                                autoComplete="off"
                                textContentType="none"
                                placeholder="Enter email"
                                placeholderTextColor={
                                    theme.colors.textSecondary
                                }
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                editable={!isPending}
                                onSubmitEditing={onSubmit}
                            />
                        )}
                    />
                    {errors.email && (
                        <Text style={styles.errorText}>
                            {errors.email.message}
                        </Text>
                    )}
                    <View style={styles.captionContainer}>
                        <Text>Password</Text>
                        <Pressable
                            style={styles.icon}
                            onPress={() => setVisible((prev) => !prev)}
                        >
                            <Ionicons
                                name={
                                    isVisible
                                        ? 'eye-off-outline'
                                        : 'eye-outline'
                                }
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
                                secureTextEntry={!isVisible}
                                style={[
                                    styles.formInput,
                                    errors.password && {
                                        borderColor: theme.colors.error,
                                    },
                                ]}
                                autoComplete="off"
                                textContentType="none"
                                placeholder="Enter password"
                                placeholderTextColor={
                                    theme.colors.textSecondary
                                }
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                editable={!isPending}
                                onSubmitEditing={onSubmit}
                            />
                        )}
                    />
                    {errors.password && (
                        <Text style={styles.errorText}>
                            {errors.password.message}
                        </Text>
                    )}
                    <Controller
                        control={control}
                        name="confirmPassword"
                        render={({ field: { value, onChange, onBlur } }) => (
                            <TextInput
                                secureTextEntry={!isVisible}
                                style={[
                                    styles.formInput,
                                    errors.confirmPassword && {
                                        borderColor: theme.colors.error,
                                    },
                                ]}
                                autoComplete="off"
                                textContentType="none"
                                placeholder="Confirm password"
                                placeholderTextColor={
                                    theme.colors.textSecondary
                                }
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                editable={!isPending}
                                onSubmitEditing={onSubmit}
                            />
                        )}
                    />
                    {errors.confirmPassword && (
                        <Text style={styles.errorText}>
                            {errors.confirmPassword.message}
                        </Text>
                    )}

                    <TouchableOpacity
                        onPress={() => onSubmit()}
                        style={styles.submitButton}
                        disabled={isPending}
                    >
                        {isPending ? (
                            <ActivityIndicator />
                        ) : (
                            <Text
                                style={{
                                    color: 'black',
                                    fontWeight: 'bold',
                                }}
                            >
                                Register
                            </Text>
                        )}
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
        padding:
            Platform.OS === 'android' ? theme.spacing.md : theme.spacing.sm,
        backgroundColor: theme.colors.backgroundSecondary,
        borderRadius: theme.spacing.xs,
        alignItems: 'center',
    },
    formInput: {
        borderColor: theme.colors.borderSecondary,
        padding:
            Platform.OS === 'android' ? theme.spacing.md : theme.spacing.sm,
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
        minHeight: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
    },
    errorText: {
        textAlign: 'left',
        color: theme.colors.error,
        ...theme.typography.caption,
    },
});
