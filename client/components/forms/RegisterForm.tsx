import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { StyleSheet } from 'react-native';
import { theme } from '@/theme/theme';
import { RegisterSchema, RegisterType } from '@/validation/userValidation';
import CustomButton from '../common/Button';
import { Text } from '../common/Text';
import FormContainer from './FormContainer';
import ControlledFormInput from './ControlledFormInput';
import { useMutation } from '@tanstack/react-query';
import { registerUser } from '@/services/auth';

export default function RegisterForm() {
    const router = useRouter();

    const { mutate, isError, isPending, error } = useMutation({
        mutationFn: (userData: RegisterType) => {
            return registerUser(userData);
        },
        onSuccess: () => {
            router.replace('/(auth)/login');
        },
    });

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
        <FormContainer>
            {isPending && <Text>Loading...</Text>}
            {isError && <Text>Error: {error.message}</Text>}
            <Text style={styles.title}>Create a new account</Text>
            <ControlledFormInput
                control={control}
                name="username"
                placeholder="Enter username *"
                errors={errors}
            />
            <ControlledFormInput
                control={control}
                name="email"
                placeholder="Enter email *"
                errors={errors}
            />
            <ControlledFormInput
                control={control}
                name="password"
                placeholder="Enter password *"
                errors={errors}
                keyboardType="email-address"
            />
            <ControlledFormInput
                control={control}
                name="confirmPassword"
                placeholder="Confirm password *"
                errors={errors}
                secureTextEntry
            />

            <CustomButton title="Register" onPress={onSubmit} />
            <Link href="/login" style={{ paddingTop: theme.spacing.md }}>
                <Text style={{ color: theme.colors.text }}>
                    Already have an account? Sign in
                </Text>
            </Link>
        </FormContainer>
    );
}

const styles = StyleSheet.create({
    title: {
        ...theme.typography.h2,
        color: theme.colors.text,
        marginBottom: theme.spacing.lg,
    },
});
