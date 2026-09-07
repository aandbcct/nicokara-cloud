export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "nicokara:theme";
export const THEME_CHANGE_EVENT = "nicokara:theme-change";

export function normalizeTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

// Apply the saved palette before the page content paints.
export const THEME_INITIALIZATION_SCRIPT = `try {
  document.documentElement.dataset.theme = localStorage.getItem("${THEME_STORAGE_KEY}") === "dark" ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}`;
