// Pure logic for HaveIBeenPwned's Pwned Passwords k-anonymity API
// (https://haveibeenpwned.com/Passwords): only a 5-character SHA-1 prefix
// ever needs to leave the device -- the API returns every known-breached
// hash sharing that prefix, and the match is decided locally against the
// full hash's remaining 35 characters. No API key, no rate limit. Kept free
// of any webextension-polyfill import so it's testable without a browser
// extension context -- see content/leakedPasswordCheck.ts for the actual
// content script wiring this into blur/submit events.

export async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function splitHashForRangeQuery(hashHex: string): { prefix: string; suffix: string } {
  return { prefix: hashHex.slice(0, 5), suffix: hashHex.slice(5) };
}

/** HIBP's range response is newline-separated "SUFFIX:COUNT" lines (CRLF in
 * practice, tolerated here via a case-insensitive, whitespace-trimmed
 * comparison rather than assuming an exact line ending). */
export function isSuffixInRangeResponse(responseBody: string, suffix: string): boolean {
  const target = suffix.trim().toUpperCase();
  return responseBody.split("\n").some((line) => line.split(":")[0]?.trim().toUpperCase() === target);
}
