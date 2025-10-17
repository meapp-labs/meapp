import { create } from 'zustand';

import { Friend } from '@/components/FriendsScreen';

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

type FriendStore = {
  selectedFriend: Friend | null;
  setSelectedFriend: (friend: Friend | null) => void;
};

export const useFriendStore = create<FriendStore>((set) => ({
  selectedFriend: null,
  setSelectedFriend: (friend) => set({ selectedFriend: friend }),
}));
