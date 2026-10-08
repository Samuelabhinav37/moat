// Names for the attributes, classes and element ids Moat puts into a page.
// They used to read "moat-..." and "data-moat-...", so any page could check
// for them and tell that Moat in particular was installed: a bit of
// fingerprint, and a target for sites that block ad blockers. Each name is
// now random for the page load, so there's nothing fixed to look for.

/** A fresh name: a letter, then 10 hex digits, valid as an HTML id, a CSS
 * class and the tail of a data- attribute. */
export function pageMarker(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return "k" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
