import { browserStoragePrefix } from "@/runtime";

export type ColorTheme = "light" | "dark";
export type Appearance = "default" | "github";

const THEME_STORAGE_KEY = `${browserStoragePrefix}.theme`;
const APPEARANCE_STORAGE_KEY = `${browserStoragePrefix}.appearance`;

export function readStoredAppearance(): Appearance {
  try {
    return window.localStorage.getItem(APPEARANCE_STORAGE_KEY) === "github" ? "github" : "default";
  } catch {
    return "default";
  }
}

export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.appearance = appearance;
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
}

export function saveAppearance(appearance: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    // Appearance remains usable without persistent storage.
  }
}

export function readStoredTheme(): ColorTheme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = document.documentElement.dataset.appearance === "github"
    ? theme === "dark" ? "#0d1117" : "#ffffff"
    : theme === "dark" ? "#121018" : "#fbfaf8";
}

export function saveTheme(theme: ColorTheme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme still applies for the current session if storage is unavailable.
  }
}
