import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { getFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { queryClient } from '@/lib/queryInit';
import { logStartupInfo } from '@/lib/startupInfo';
import { useAuthStore } from '@/lib/stores';
import { toastConfig } from '@/misc/toastConfig';
import { RememberMeStorage } from '@/services/storage';
import { theme } from '@/theme/theme';

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
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const username = useAuthStore((state) => state.username);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!!username}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
      </AuthProvider>
      <Toast config={toastConfig} />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
});
