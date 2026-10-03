// Light or dark for every Moat page. <html data-theme="light|dark"> is set
// before the first paint (themeBoot.ts); theme.css and each page's own
// styles key their light colours off that attribute.
//
// The choice lives in settings.theme, synced with the other settings. Storage
// is async and would flash the wrong theme on load, so the pages also keep a
// copy in localStorage, which reads synchronously.

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CACHE_KEY = "moat-theme";

export function resolveTheme(choice: string | null | undefined, prefersLight: boolean): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  return prefersLight ? "light" : "dark";
}

export function readCachedChoice(win: Window = window): string | null {
  try {
    return win.localStorage.getItem(THEME_CACHE_KEY);
  } catch {
    return null;
  }
}

export function applyTheme(choice: string | null = readCachedChoice(), win: Window = window): void {
  const prefersLight = typeof win.matchMedia === "function" && win.matchMedia("(prefers-color-scheme: light)").matches;
  win.document.documentElement.dataset.theme = resolveTheme(choice, prefersLight);
}
