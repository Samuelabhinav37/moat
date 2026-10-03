// Loaded by a plain <script> in each page's <head>, so it runs before the
// first paint. See theme.ts.
import { THEME_CACHE_KEY, applyTheme } from "./theme";

applyTheme();
// "System" follows the device when it switches between light and dark.
window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => applyTheme());
// Another open Moat page changed the choice.
window.addEventListener("storage", (event) => {
  if (event.key === THEME_CACHE_KEY) applyTheme(event.newValue);
});
