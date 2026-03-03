export type ThemeMode = "light" | "dark";
export type ColorTheme = "slate" | "ocean" | "sunset" | "forest";

const THEME_MODE_STORAGE = "booking_ops_theme_mode";
const COLOR_THEME_STORAGE = "booking_ops_color_theme";

function safeGetStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

export function getSavedThemeMode(): ThemeMode {
  const raw = safeGetStorage(THEME_MODE_STORAGE);
  return raw === "dark" ? "dark" : "light";
}

export function getSavedColorTheme(): ColorTheme {
  const raw = safeGetStorage(COLOR_THEME_STORAGE);
  if (raw === "ocean" || raw === "sunset" || raw === "forest" || raw === "slate") {
    return raw;
  }
  return "slate";
}

export function applyTheme(mode: ThemeMode, colorTheme: ColorTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.setAttribute("data-theme", colorTheme);
}

export function setThemeMode(mode: ThemeMode) {
  safeSetStorage(THEME_MODE_STORAGE, mode);
}

export function setColorTheme(theme: ColorTheme) {
  safeSetStorage(COLOR_THEME_STORAGE, theme);
}

export function initializeTheme() {
  applyTheme(getSavedThemeMode(), getSavedColorTheme());
}
