import { useAuthStore } from '@/stores/authStore';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import 'react-native-reanimated';

export default function RootLayout() {
    const username = useAuthStore((state: any) => state.username);

    return (
        <ThemeProvider value={DarkTheme}>
            <Stack>
                <Stack.Protected guard={username}>
                    <Stack.Screen name="(app)" />
                </Stack.Protected>

                <Stack.Protected guard={!username}>
                    <Stack.Screen name="sign-in" />
                </Stack.Protected>
            </Stack>
        </ThemeProvider>
    );
}
