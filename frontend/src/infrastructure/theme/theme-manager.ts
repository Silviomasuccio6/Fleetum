export type ThemeMode = "light" | "dark";

export const themeStorageKey = "fermi_theme_mode";

export const getStoredTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "light";
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(themeStorageKey); } catch { /* Fall back to the system preference. */ }
  if (stored === "dark" || stored === "light") return stored;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const applyTheme = (theme: ThemeMode) => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
};

export const setTheme = (theme: ThemeMode) => {
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(themeStorageKey, theme); } catch { /* Still apply the selection for this session. */ }
  }
  applyTheme(theme);
};

export const initTheme = (): ThemeMode => {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
};
