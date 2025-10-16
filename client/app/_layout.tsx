import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';

import { Loader } from '@/components/Loader';
import { getFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { queryClient } from '@/lib/queryInit';
import { logStartupInfo } from '@/lib/startupInfo';
import { useAuthStore } from '@/lib/stores';
import { toastConfig } from '@/misc/toastConfig';
import { RememberMeStorage } from '@/services/storage';

// Log startup information when the app loads
logStartupInfo();

function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUsername = useAuthStore((state) => state.setUsername);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      const rememberMe = await RememberMeStorage.get();

      if (!rememberMe) {
        setIsCheckingAuth(false);
        return;
      }

      try {
        const response = await getFetcher<{ username: string }>(Keys.Query.ME);
        setUsername(response.username);
      } catch {
        // Session invalid or expired - clear remember me flag
        await RememberMeStorage.clear();
      } finally {
        setIsCheckingAuth(false);
      }
    };

    void checkSession();
  }, [setUsername]);

  if (isCheckingAuth) {
    return <Loader text="MeApping..." />;
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const username = useAuthStore((state) => state.username);
  const isAuthenticated = !!username;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          {/* Auth routes - only accessible when NOT logged in */}
          <Stack.Protected guard={!isAuthenticated}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>

          {/* Protected routes - only accessible when logged in */}
          <Stack.Protected guard={isAuthenticated}>
            <Stack.Screen name="(chat)" />
          </Stack.Protected>
        </Stack>
      </AuthProvider>
      <Toast config={toastConfig} />
    </QueryClientProvider>
  );
}
