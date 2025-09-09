import { create } from 'zustand';

export type Friend = {
    id: string;
    name: string;
};

type PressedState = {
    pressed: Friend | null;
    setPressed: (friend: Friend | null) => void;
};

export const usePressedStore = create<PressedState>((set) => ({
    pressed: null,
    setPressed: (friend) => set({ pressed: friend }),
}));
