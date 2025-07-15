import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useAuthStore } from '@/stores/authStore';
import styles from '@/styles';
import { Button } from '@react-navigation/elements';
import { Link, useRouter } from 'expo-router';
import { TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';

type FormData = {
    username: string;
};

export default function SignInScreen() {
    const router = useRouter();
    const setUsername = useAuthStore((state: any) => state.setUsername);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<FormData>({
        defaultValues: {
            username: '',
        },
    });

    const onSubmit = handleSubmit((data: FormData) => {
        setUsername(data.username);
        router.navigate('/');
    });

    return (
        <ThemedView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <SafeAreaView
                    style={{
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <View style={styles.formContainer}>
                        <ThemedText type="title" style={{ marginBottom: 20 }}>
                            Sign in to your account
                        </ThemedText>
                        <Controller
                            control={control}
                            rules={{
                                required: true,
                            }}
                            render={({
                                field: { onChange, onBlur, value },
                            }) => (
                                <TextInput
                                    style={styles.input}
                                    placeholder="Username"
                                    onBlur={onBlur}
                                    onChangeText={onChange}
                                    value={value}
                                />
                            )}
                            name="username"
                        />
                        {errors.username && (
                            <ThemedText>This is required.</ThemedText>
                        )}
                        <Button
                            style={styles.signButton}
                            color="#007AFF"
                            onPress={onSubmit}
                        >
                            Confirm
                        </Button>
                        <Link href="/sign-up" style={{ paddingTop: 10 }}>
                            <ThemedText
                                style={{ color: '#007aff', fontSize: 14 }}
                            >
                                Sign up
                            </ThemedText>
                        </Link>
                    </View>
                </SafeAreaView>
            </SafeAreaProvider>
        </ThemedView>
    );
}
