import { create } from 'zustand'

export const useThreadWindow = create<{
  roomId: string | null
  rootId: string | null
  open: (roomId: string, rootId: string) => void
  close: () => void
}>((set) => ({
  roomId: null,
  rootId: null,
  open: (roomId, rootId) => set({ roomId, rootId }),
  close: () => set({ roomId: null, rootId: null }),
}))
