const KEY = "fermi_platform_token";
let inMemoryToken: string | null = null;
let sessionRevision = 0;

const hasSessionStorage = () => typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

export const platformAuthStorage = {
  revision: () => sessionRevision,
  get: () => {
    if (hasSessionStorage()) return window.sessionStorage.getItem(KEY);
    return inMemoryToken;
  },
  set: (token: string) => {
    sessionRevision += 1;
    if (hasSessionStorage()) {
      window.sessionStorage.setItem(KEY, token);
      return;
    }
    inMemoryToken = token;
  },
  clear: () => {
    sessionRevision += 1;
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
