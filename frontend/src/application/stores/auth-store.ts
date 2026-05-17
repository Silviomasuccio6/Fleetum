import { create } from "zustand";
import { User } from "../../domain/entities/models";
import { tokenStorage } from "../../infrastructure/auth/token-storage";

type AuthState = {
  user: User | null;
  isAuthenticated: boolean;
  authChecked: boolean;
  setSession: (user: User, remember?: boolean) => void;
  setUser: (user: User | null) => void;
  setAuthChecked: (checked: boolean) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  authChecked: false,
  setSession: (user, remember = true) => {
    tokenStorage.setRemember(remember);
    set({ user, isAuthenticated: true, authChecked: true });
  },
  setUser: (user) => set({ user, isAuthenticated: Boolean(user), authChecked: true }),
  setAuthChecked: (checked) => set({ authChecked: checked }),
  logout: () => {
    tokenStorage.clear();
    set({ user: null, isAuthenticated: false, authChecked: true });
  }
}));
