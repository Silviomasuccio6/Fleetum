const REMEMBER_KEY = "fermi_auth_remember";
const CSRF_KEY = "fermi_csrf_token";

export const tokenStorage = {
  getCsrf: () => localStorage.getItem(CSRF_KEY) ?? sessionStorage.getItem(CSRF_KEY),
  setCsrf: (csrfToken: string, remember?: boolean) => {
    const shouldRemember = remember ?? (localStorage.getItem(REMEMBER_KEY) ?? sessionStorage.getItem(REMEMBER_KEY) ?? "1") === "1";
    if (shouldRemember) {
      localStorage.setItem(CSRF_KEY, csrfToken);
      sessionStorage.removeItem(CSRF_KEY);
      return;
    }
    sessionStorage.setItem(CSRF_KEY, csrfToken);
    localStorage.removeItem(CSRF_KEY);
  },
  setRemember: (remember = true) => {
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, "1");
      sessionStorage.removeItem(REMEMBER_KEY);
      return;
    }
    sessionStorage.setItem(REMEMBER_KEY, "0");
    localStorage.removeItem(REMEMBER_KEY);
  },
  shouldRemember: () => (localStorage.getItem(REMEMBER_KEY) ?? sessionStorage.getItem(REMEMBER_KEY) ?? "1") === "1",
  clear: () => {
    localStorage.removeItem(REMEMBER_KEY);
    localStorage.removeItem(CSRF_KEY);
    sessionStorage.removeItem(REMEMBER_KEY);
    sessionStorage.removeItem(CSRF_KEY);
  }
};
