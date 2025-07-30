import { useAuthStore } from '@/stores/authStore';
import { theme } from '@/theme/theme';
import { Stack } from 'expo-router';

export default function RootLayout() {
    const username = useAuthStore((state: any) => state.username);

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
            }}
        >
            <Stack.Protected guard={username}>
                <Stack.Screen name="(tabs)" />
            </Stack.Protected>

            <Stack.Protected guard={!username}>
                <Stack.Screen name="login" />
                <Stack.Screen name="register" />
            </Stack.Protected>
        </Stack>
    );
}
