// Shared between popup.ts and options.ts: applies WebExtension i18n messages
// to every [data-i18n] element in a document, and a small fallback wrapper
// around browser.i18n.getMessage(), which silently returns "" for an
// unknown key -- a real risk during a large mechanical string migration,
// where a typo'd key would otherwise blank a piece of UI with no error.
// Both take an injectable getMessage function so they're testable without a
// real extension context (no webextension-polyfill import here at all).

export type GetMessage = (key: string, substitutions?: string | string[]) => string;

export function getMessageOrFallback(getMessage: GetMessage, key: string, fallback: string, substitutions?: string | string[]): string {
  const message = getMessage(key, substitutions);
  return message === "" ? fallback : message;
}

/** Walks every [data-i18n] element under `root` and replaces its text with
 * the looked-up message, falling back to whatever text was already there
 * (the English copy left in the HTML as a dev-readability aid) if the key
 * doesn't resolve. */
export function applyStaticI18n(root: ParentNode, getMessage: GetMessage): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n;
    if (!key) continue;
    el.textContent = getMessageOrFallback(getMessage, key, el.textContent ?? "");
  }
}
