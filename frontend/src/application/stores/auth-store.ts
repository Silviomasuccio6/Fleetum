import { create } from "zustand";
import { User } from "../../domain/entities/models";
import { tokenStorage } from "../../infrastructure/auth/token-storage";
import { useEntitlementsStore } from "./entitlements-store";

type AuthState = {
  user: User | null;
  isAuthenticated: boolean;
  authChecked: boolean;
  setSession: (user: User, remember?: boolean) => void;
  setUser: (user: User | null) => void;
  setAuthChecked: (checked: boolean) => void;
  logout: () => void;
};

const resetEntitlementsForSessionChange = () => {
  useEntitlementsStore.getState().reset();
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  authChecked: false,
  setSession: (user, remember = true) => {
    if (get().user?.tenantId && get().user?.tenantId !== user.tenantId) {
      resetEntitlementsForSessionChange();
    }
    tokenStorage.setRemember(remember);
    set({ user, isAuthenticated: true, authChecked: true });
  },
  setUser: (user) => {
    const previousTenantId = get().user?.tenantId;
    if (!user || (previousTenantId && previousTenantId !== user.tenantId)) {
      resetEntitlementsForSessionChange();
    }
    set({ user, isAuthenticated: Boolean(user), authChecked: true });
  },
  setAuthChecked: (checked) => set({ authChecked: checked }),
  logout: () => {
    tokenStorage.clear();
    resetEntitlementsForSessionChange();
    set({ user: null, isAuthenticated: false, authChecked: true });
  }
}));
