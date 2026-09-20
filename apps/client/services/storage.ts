import AsyncStorage from '@react-native-async-storage/async-storage'

const APP_NAMESPACE = '@meapp:'

export const STORAGE_KEYS = {
  REMEMBER_ME: `${APP_NAMESPACE}rememberMe`,
  SELECTED_CONVERSATION_ID: `${APP_NAMESPACE}selectedConversationId`,
} as const

async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error(`Failed to save "${key}":`, error)
  }
}

async function getItem<T>(key: string): Promise<T | null> {
  try {
    const item = await AsyncStorage.getItem(key)
    return item ? (JSON.parse(item) as T) : null
  } catch {
    // Corrupted value — drop it
    await AsyncStorage.removeItem(key).catch(() => {})
    return null
  }
}

async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key)
  } catch (error) {
    console.error(`Failed to remove "${key}":`, error)
  }
}

export const RememberMeStorage = {
  save: () => setItem(STORAGE_KEYS.REMEMBER_ME, true),
  get: () => getItem<boolean>(STORAGE_KEYS.REMEMBER_ME),
  clear: () => removeItem(STORAGE_KEYS.REMEMBER_ME),
}

export const ConversationStorage = {
  save: (id: string) => setItem(STORAGE_KEYS.SELECTED_CONVERSATION_ID, id),
  clear: () => removeItem(STORAGE_KEYS.SELECTED_CONVERSATION_ID),
}
