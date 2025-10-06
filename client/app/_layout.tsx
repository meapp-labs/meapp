import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import Toast from 'react-native-toast-message';

import { queryClient } from '@/lib/queryInit';
import { useAuthStore } from '@/lib/stores';
import { toastConfig } from '@/misc/toastConfig';

export default function RootLayout() {
  const username = useAuthStore((state) => state.username);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!username}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
      </Stack>
      <Toast config={toastConfig} />
    </QueryClientProvider>
  );
}
