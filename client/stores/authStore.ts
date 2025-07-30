import { create } from 'zustand';

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
