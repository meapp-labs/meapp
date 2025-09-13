import { Friend } from '@/components/FriendsScreen';
import { create } from 'zustand';

type PressedState = {
    pressed: Friend | null;
    setPressed: (friend: Friend | null) => void;
};

export const usePressedStore = create<PressedState>((set) => ({
    pressed: null,
    setPressed: (friend) => set({ pressed: friend }),
}));
