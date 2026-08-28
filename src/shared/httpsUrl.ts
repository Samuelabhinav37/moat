// Every URL in AthenaConfig is admin-supplied via chrome.storage.managed,
// unlike every other network endpoint Moat contacts elsewhere in this
// codebase (all hardcoded to Moat's own https:// URLs at build time). A
// misconfigured or downgraded http:// endpoint here would send the bootstrap
// secret and session token in cleartext, so every Athena call site checks
// this before using an admin-supplied URL at all, rather than trusting
// whatever scheme was configured.
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
