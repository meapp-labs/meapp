import { useAuthStore } from '@/stores/authStore';
import { Link, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { theme } from '@/theme/theme';
import { LoginSchema, LoginType } from '@/validation/userValidation';
import Button from '../common/Button';
import { Text } from '../common/Text';
import FormContainer from './FormContainer';
import ControlledFormInput from './ControlledFormInput';
import { useMutation } from '@tanstack/react-query';
import { loginUser } from '@/services/auth';

export default function LoginForm() {
    const router = useRouter();
    const setUsername = useAuthStore((state) => state.setUsername);

    const { mutate, isError, isPending, error } = useMutation({
        mutationFn: (userData: LoginType) => {
            return loginUser(userData);
        },
        onSuccess: (_, variables) => {
            router.replace('/');
            setUsername(variables.username);
        },
    });

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
        mutate(data);
    });

    return (
        <FormContainer>
            {isPending && <Text>Loading...</Text>}
            {isError && <Text>error {error.message}</Text>}
            <Text style={styles.title}>Sign in to your account</Text>
            <ControlledFormInput
                control={control}
                name="username"
                placeholder="Enter username *"
                errors={errors}
            />
            <ControlledFormInput
                control={control}
                name="password"
                placeholder="Enter password *"
                errors={errors}
                secureTextEntry
            />

            <Button title="Login" onPress={onSubmit} />
            <Link href="/register" style={{ paddingTop: theme.spacing.md }}>
                <Text style={{ color: theme.colors.text }}>
                    Don&apos;t have an account? Sign up
                </Text>
            </Link>
        </FormContainer>
    );
}

const styles = StyleSheet.create({
    title: {
        ...theme.typography.h2,
        color: theme.colors.text,
        marginBottom: theme.spacing.xl,
    },
});
