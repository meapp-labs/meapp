import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** AsyncStorage with a localStorage fallback on web. */
const appStorage = {
  getItem: async (name: string): Promise<string | null> =>
    Platform.OS === 'web' && typeof localStorage !== 'undefined'
      ? localStorage.getItem(name)
      : AsyncStorage.getItem(name),
  setItem: async (name: string, value: string): Promise<void> =>
    Platform.OS === 'web' && typeof localStorage !== 'undefined'
      ? localStorage.setItem(name, value)
      : AsyncStorage.setItem(name, value),
  removeItem: async (name: string): Promise<void> =>
    Platform.OS === 'web' && typeof localStorage !== 'undefined'
      ? localStorage.removeItem(name)
      : AsyncStorage.removeItem(name),
}

type AuthStore = {
  username: string
  setUsername: (username: string) => void
  reset: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      username: '',
      setUsername: (username: string) => set({ username }),
      reset: () => set({ username: '' }),
    }),
    {
      name: 'meapp-auth',
      version: 1,
      storage: createJSONStorage(() => appStorage),
    },
  ),
)

type ConversationStore = {
  selectedConversationId: string | null
  setSelectedConversationId: (id: string | null) => void
}

export const useConversationStore = create<ConversationStore>()(
  persist(
    (set) => ({
      selectedConversationId: null,
      setSelectedConversationId: (id: string | null) => set({ selectedConversationId: id }),
    }),
    {
      name: 'meapp-conversation',
      version: 1,
      storage: createJSONStorage(() => appStorage),
    },
  ),
)
