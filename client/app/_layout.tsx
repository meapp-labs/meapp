import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';

import { queryClient } from '@/lib/queryInit';
import { useAuthStore } from '@/lib/stores';

export default function RootLayout() {
  const username = useAuthStore((state: any) => state.username);

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
