import { create } from 'zustand';

export const useAuthStore = create((set) => ({
    username: '',
    setUsername: (username: string) =>
        set(() => ({
            username: username,
        })),
}));
