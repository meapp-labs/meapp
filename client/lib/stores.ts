import { create } from 'zustand';

import type { Conversation } from '@/types/models';

type AuthStore = {
  username: string;
  setUsername: (by: string) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  username: '',
  setUsername: (username: string) =>
    set(() => ({
      username: username,
    })),
}));

type ConversationStore = {
  selectedConversation: Conversation | null;
  setSelectedConversation: (conversation: Conversation | null) => void;
};

export const useConversationStore = create<ConversationStore>((set) => ({
  selectedConversation: null,
  setSelectedConversation: (conversation) =>
    set({ selectedConversation: conversation }),
}));

// Legacy alias for backwards compatibility during migration
export const useFriendStore = useConversationStore;
