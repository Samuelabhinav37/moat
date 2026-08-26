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
