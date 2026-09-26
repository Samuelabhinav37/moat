// A random, unguessable token. crypto.randomUUID() only exists in secure
// contexts, so a content script on a plain-http page (which shares the
// page's secure-context status) gets undefined and throws. getRandomValues()
// exists everywhere and is just as random.
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
