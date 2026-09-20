import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const TOKEN_KEY = 'meapp_auth_token'
let inMemoryToken: string | null = null

/**
 * Native: token lives in the OS keystore/Keychain (expo-secure-store), never
 * in plaintext AsyncStorage. Web: cookie-only — the server sets an HttpOnly
 * cookie, so no JS-side token storage at all.
 */
export const AuthStorage = {
  async setToken(token: string | null): Promise<void> {
    inMemoryToken = token
    if (Platform.OS === 'web') return
    try {
      if (token) {
        await SecureStore.setItemAsync(TOKEN_KEY, token)
      } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY)
      }
    } catch {}
  },

  async getToken(): Promise<string | null> {
    if (inMemoryToken) return inMemoryToken
    if (Platform.OS === 'web') return null
    try {
      inMemoryToken = await SecureStore.getItemAsync(TOKEN_KEY)
      return inMemoryToken
    } catch {
      return null
    }
  },

  async clear(): Promise<void> {
    inMemoryToken = null
    if (Platform.OS === 'web') return
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY)
    } catch {}
  },
}
