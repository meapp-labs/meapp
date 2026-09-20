import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type AuthStore = {
  username: string
  token: string | null
  setUsername: (username: string) => void
  setToken: (token: string | null) => void
  reset: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      username: '',
      token: null,
      setUsername: (username: string) => set({ username }),
      setToken: (token: string | null) => set({ token }),
      reset: () => set({ username: '', token: null }),
    }),
    {
      name: 'meapp-auth',
      storage: createJSONStorage(() => AsyncStorage),
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
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)
