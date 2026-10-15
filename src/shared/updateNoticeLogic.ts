// Pure version-comparison logic, split out of background/updateNotice.ts
// (which imports webextension-polyfill and throws on import outside a real
// extension context) so it's testable without a browser extension context --
// same convention as shared/rulesetManifest.ts / background/rulesetManifestLoader.ts.

/** Doesn't fire on a fresh install (lastSeenVersion is undefined, since
 * recordUpdateSeen() is only ever called to set a *baseline* at install
 * time, never to claim a notice was already shown) or when the version
 * hasn't actually changed. */
export function shouldShowUpdateNotice(currentVersion: string, lastSeenVersion: string | undefined): boolean {
  return lastSeenVersion !== undefined && lastSeenVersion !== currentVersion;
}

/** What onInstalled should store as lastSeenVersion, or undefined to leave it.
 * Only an install (or a copy that never stored one) records a baseline. An
 * update must leave the old version in place: the popup compares it with the
 * new one to show "Moat updated", then stores the new one itself. Writing it
 * here on update hid the notice from every update before 0.11.284. */
export function lastSeenAfterInstalled(reason: string, stored: string | undefined, currentVersion: string): string | undefined {
  if (reason === "install" || stored === undefined) return stored === currentVersion ? undefined : currentVersion;
  return undefined;
}
