import { useAuthStore } from '@/stores/authStore';

import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export default function RootLayout() {
    const username = useAuthStore((state: any) => state.username);
    const queryClient = new QueryClient();

    return (
        <QueryClientProvider client={queryClient}>
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Protected guard={!!username}>
                    <Stack.Screen name="(tabs)" />
                </Stack.Protected>
            </Stack>
        </QueryClientProvider>
    );
}
