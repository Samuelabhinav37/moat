// The cheap check consentRejector.ts runs before loading the full
// Consent-O-Matic rules: is any platform's banner target on the page? The
// targets come from scripts/lib/consentPresence.mjs at build time.

export interface ConsentPresence {
  /** Present-matcher target selectors. */
  selectors: string[];
  /** [selector, texts]: targets that also need one of the texts. */
  texts: [string, string[]][];
}

function found(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null; // A selector this browser can't parse.
  }
}

/** Whether any known consent platform's banner target is on the page. */
export function platformPresent(presence: ConsentPresence, root: ParentNode = document): boolean {
  if (presence.selectors.some((selector) => found(root, selector) !== null)) return true;
  return presence.texts.some(([selector, needles]) => {
    const text = found(root, selector)?.textContent ?? "";
    return needles.some((needle) => text.includes(needle));
  });
}
