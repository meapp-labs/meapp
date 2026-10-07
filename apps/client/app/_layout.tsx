import { QueryClientProvider, focusManager } from '@tanstack/react-query'
import '../theme/web.css'
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'
import Toast from 'react-native-toast-message'

import { Loader } from '@/components/Loader'
import { getFetcher, postFetcher } from '@/lib/api'
import { AuthStorage } from '@/lib/authStorage'
import { Keys } from '@/lib/keys'
import { useRealtimeStore } from '@/lib/polling'
import { queryClient } from '@/lib/queryInit'
import { logStartupInfo } from '@/lib/startupInfo'
import { useAuthStore } from '@/lib/stores'
import { toastConfig } from '@/misc/toastConfig'
import { resumeMediaUploads } from '@/services/media'
import { clearMediaCache, pruneMediaCache } from '@/services/mediaCache'
import { RememberMeStorage } from '@/services/storage'

// Log startup information when the app loads
logStartupInfo()

function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUsername = useAuthStore((state) => state.setUsername)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      // Native cache survives restarts. Never reuse a previous session's plaintext.
      await clearMediaCache()
      const rememberMe = await RememberMeStorage.get()

      if (!rememberMe) {
        // End a previous cookie or native session before showing the login screen.
        await postFetcher('logout').catch(() => undefined)
        await AuthStorage.clear()
        await clearMediaCache()
        setUsername('')
        setIsCheckingAuth(false)
        return
      }

      try {
        const response = await getFetcher<{ username: string }>(Keys.Query.ME)
        setUsername(response.username)
      } catch {
        // Session invalid or expired - clear remember me flag and token
        await RememberMeStorage.clear()
        await AuthStorage.clear()
        await clearMediaCache()
        setUsername('')
      } finally {
        setIsCheckingAuth(false)
      }
    }

    void checkSession()
  }, [setUsername])

  if (isCheckingAuth) {
    return <Loader text="MeApping..." />
  }

  return <>{children}</>
}

export default function RootLayout() {
  useEffect(() => {
    const update = (active: boolean) => {
      useRealtimeStore.getState().setActive(active)
      focusManager.setFocused(active)
    }
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const changed = () => update(document.visibilityState === 'visible')
      changed()
      document.addEventListener('visibilitychange', changed)
      return () => document.removeEventListener('visibilitychange', changed)
    }
    update(AppState.currentState === 'active')
    const subscription = AppState.addEventListener('change', (state) => update(state === 'active'))
    return () => subscription.remove()
  }, [])
  const username = useAuthStore((state) => state.username)
  const isAuthenticated = !!username
  useEffect(() => {
    if (!username) return
    let stopped = false
    const resume = () => {
      if (stopped || !useRealtimeStore.getState().active) return
      pruneMediaCache()
      void resumeMediaUploads()
        .then((sent) => {
          if (sent.length && !stopped) void queryClient.invalidateQueries()
        })
        .catch((error: unknown) => {
          console.warn('[Media] Upload retry deferred:', error)
        })
    }
    resume()
    const timer = setInterval(resume, 60_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [username])

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
  )
}
