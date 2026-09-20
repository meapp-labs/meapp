import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

const TOKEN_KEY = '@meapp:auth_token'
let inMemoryToken: string | null = null

export const AuthStorage = {
  async setToken(token: string | null): Promise<void> {
    inMemoryToken = token
    if (Platform.OS === 'web') return
    try {
      if (token) {
        await AsyncStorage.setItem(TOKEN_KEY, token)
      } else {
        await AsyncStorage.removeItem(TOKEN_KEY)
      }
    } catch {}
  },

  async getToken(): Promise<string | null> {
    if (inMemoryToken) return inMemoryToken
    if (Platform.OS === 'web') return null
    try {
      inMemoryToken = await AsyncStorage.getItem(TOKEN_KEY)
      return inMemoryToken
    } catch {
      return null
    }
  },

  async clear(): Promise<void> {
    inMemoryToken = null
    if (Platform.OS === 'web') return
    try {
      await AsyncStorage.removeItem(TOKEN_KEY)
    } catch {}
  },
}
