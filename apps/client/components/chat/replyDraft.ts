import type { Message } from '@meapp/shared'
import { create } from 'zustand'

export const useReplyDraft = create<{
  roomId: string | null
  message: Message | null
  threadRootId: string | null
  select: (roomId: string, message: Message, threadRootId?: string) => void
  clear: () => void
}>((set) => ({
  roomId: null,
  message: null,
  threadRootId: null,
  select: (roomId, message, threadRootId) =>
    set({ roomId, message, threadRootId: threadRootId ?? null }),
  clear: () => set({ roomId: null, message: null, threadRootId: null }),
}))

// Memory only: never put decrypted drafts in unencrypted persisted storage.
export const useComposerDraft = create<{
  texts: Record<string, string>
  setText: (scope: string, text: string) => void
}>((set) => ({
  texts: {},
  setText: (scope, text) => set((state) => ({ texts: { ...state.texts, [scope]: text } })),
}))
