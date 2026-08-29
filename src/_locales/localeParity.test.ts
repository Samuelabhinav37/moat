// Static-data regression test, not a unit test of any module: reads every
// _locales/*/messages.json straight off disk and checks each non-English
// locale has the same keys and the same $PLACEHOLDER$ tokens as English --
// the one thing that actually breaks a translation silently (a missing key
// falls back to English at runtime, harmless; a placeholder typo just
// never gets substituted, showing the literal "$COUNT$" to a real user).
// Catches drift the moment a new English string is added without its
// translations following, rather than someone noticing a blank/wrong
// string in a specific language months later.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = dirname(fileURLToPath(import.meta.url));

interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

function loadMessages(locale: string): Record<string, MessageEntry> {
  const path = join(localesDir, locale, "messages.json");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, MessageEntry>;
}

function placeholderTokens(message: string): string[] {
  return [...message.matchAll(/\$[A-Z_0-9]+\$/g)].map((m) => m[0]).sort();
}

const englishMessages = loadMessages("en");
const otherLocales = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "en")
  .map((entry) => entry.name);

describe("locale parity against en", () => {
  it("found at least one translated locale to check", () => {
    // A guard against this test silently checking nothing if _locales/ ever
    // moves or every non-English locale gets removed.
    expect(otherLocales.length).toBeGreaterThan(0);
  });

  it.each(otherLocales)("%s has exactly the same message keys as en", (locale) => {
    const messages = loadMessages(locale);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(englishMessages).sort());
  });

  it.each(otherLocales)("%s's placeholder tokens match en for every shared key", (locale) => {
    const messages = loadMessages(locale);
    for (const [key, enEntry] of Object.entries(englishMessages)) {
      const trEntry = messages[key];
      if (!trEntry) continue; // Missing-key case is covered by the key-parity test above.
      expect(placeholderTokens(trEntry.message), `${locale}.${key} message tokens`).toEqual(
        placeholderTokens(enEntry.message)
      );
      expect(Object.keys(trEntry.placeholders ?? {}).sort(), `${locale}.${key} placeholders object`).toEqual(
        Object.keys(enEntry.placeholders ?? {}).sort()
      );
    }
  });

  it.each(otherLocales)("%s has no empty translated message", (locale) => {
    const messages = loadMessages(locale);
    for (const [key, entry] of Object.entries(messages)) {
      expect(entry.message.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
    }
  });
});
