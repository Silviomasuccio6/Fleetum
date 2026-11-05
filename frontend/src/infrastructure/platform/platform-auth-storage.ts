const KEY = "fermi_platform_token";
let inMemoryToken: string | null = null;
let sessionRevision = 0;
const sessionListeners = new Set<() => void>();
const changed = () => { sessionRevision += 1; for (const listener of sessionListeners) listener(); };

const hasSessionStorage = () => typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

export const platformAuthStorage = {
  revision: () => sessionRevision,
  subscribe: (listener: () => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; },
  get: () => {
    if (hasSessionStorage()) return window.sessionStorage.getItem(KEY);
    return inMemoryToken;
  },
  set: (token: string) => {
    changed();
    if (hasSessionStorage()) {
      window.sessionStorage.setItem(KEY, token);
      return;
    }
    inMemoryToken = token;
  },
  clear: () => {
    changed();
    if (hasSessionStorage()) {
      window.sessionStorage.removeItem(KEY);
      return;
    }
    inMemoryToken = null;
  },
  clearIfRevision: (revision: number) => {
    if (sessionRevision !== revision) return false;
    platformAuthStorage.clear();
    return true;
  }
};
