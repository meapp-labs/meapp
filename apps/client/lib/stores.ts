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

export const chatColors = [
  { name: 'Default', color: '#0C0F14' },
  { name: 'Slate', color: '#19222E' },
  { name: 'Ocean', color: '#102A35' },
  { name: 'Forest', color: '#172C25' },
  { name: 'Plum', color: '#2A2034' },
  { name: 'Rose', color: '#34232B' },
  { name: 'Sand', color: '#302A20' },
] as const

export const useChatAppearance = create<{
  colors: Record<string, string>
  setColor: (username: string, roomId: string, color: string) => void
}>()(
  persist(
    (set) => ({
      colors: {},
      setColor: (username, roomId, color) => {
        if (!chatColors.some((option) => option.color === color)) return
        set((state) => ({ colors: { ...state.colors, [`${username}:${roomId}`]: color } }))
      },
    }),
    { name: 'meapp-chat-appearance', version: 1, storage: createJSONStorage(() => appStorage) },
  ),
)

export function useChatColor(roomId: string) {
  const username = useAuthStore((state) => state.username)
  return useChatAppearance((state) => state.colors[`${username}:${roomId}`] ?? chatColors[0].color)
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
