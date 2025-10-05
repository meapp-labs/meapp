import { create } from 'zustand';

import { Friend } from '@/components/FriendsScreen';

//username store
type AuthType = {
  username: string;
  setUsername: (by: string) => void;
};

export const useAuthStore = create<AuthType>((set) => ({
  username: '',
  setUsername: (username: string) =>
    set(() => ({
      username: username,
    })),
}));

//pressed friend store
type PressedState = {
  pressed: Friend | null;
  setPressed: (friend: Friend | null) => void;
};

export const usePressedStore = create<PressedState>((set) => ({
  pressed: null,
  setPressed: (friend) => set({ pressed: friend }),
}));
