// Pure logic behind Athena-pushed policy domains (see athenaPolicySync.ts,
// which fetches+verifies the signed envelope and applies these as dynamic
// declarativeNetRequest rules). Kept separate and pure/testable without
// mocking the browser API, same pattern as liveRedirectRules.ts.
//
// Deliberately its own reserved id range, well clear of every other dynamic-
// rule range in this codebase (customRules.ts: 800_000/810_000,
// liveRedirectRules.ts: 900_000, quickFixRules.ts: 950_000) so applying one
// never touches another's rules.
import type { DeclarativeNetRequest } from "webextension-polyfill";
import type { AthenaPolicyArtifact } from "../types";

export const ATHENA_POLICY_ID_START = 960_000;
export const MAX_ATHENA_POLICY_RULES = 1000;

// Same pattern as liveRedirectRules.ts's own copy -- three lines, not worth
// sharing an import over, and `blockedDomains` here comes from a remote,
// org-controlled (not Moat's own) source that still needs the same
// one-malformed-entry-can't-drop-everything treatment.
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function isValidArtifactShape(value: unknown): value is AthenaPolicyArtifact {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    typeof v.issuedAt === "number" &&
    Array.isArray(v.blockedDomains) &&
    v.blockedDomains.every((d) => typeof d === "string")
  );
}

/** Parses+validates the JSON string a verified SignedAthenaPolicy.payload
 * contains. Returns null for anything malformed rather than throwing --
 * callers treat that the same as "policy fetch failed," keeping whatever
 * was last successfully applied. Signature verification is a separate,
 * earlier step (shared/athenaPolicySignature.ts) -- this function assumes
 * it already passed. */
export function parsePolicyArtifact(payload: string): AthenaPolicyArtifact | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isValidArtifactShape(parsed)) return null;
  return { version: parsed.version, issuedAt: parsed.issuedAt, blockedDomains: filterValidDomains(parsed.blockedDomains).valid };
}

export function filterValidDomains(domains: string[]): { valid: string[]; rejectedCount: number } {
  const valid = domains.filter((domain) => HOSTNAME_PATTERN.test(domain));
  return { valid, rejectedCount: domains.length - valid.length };
}

/**
 * Redirects the blocked page's own main-frame navigation to the warning
 * interstitial instead of a bare failed-request -- scoped to main_frame
 * only, same reasoning as liveRedirectRules.ts (a sub-resource block
 * redirecting to an HTML page doesn't make sense). Never used for the
 * bundled consumer filter lists, which stay a plain `{type: "block"}` --
 * this rule shape only ever applies to domains an org's own Athena policy
 * named, via this module's own reserved id range.
 */
export function buildAthenaPolicyRules(domains: string[]): DeclarativeNetRequest.Rule[] {
  return domains.slice(0, MAX_ATHENA_POLICY_RULES).map((domain, index) => ({
    id: ATHENA_POLICY_ID_START + index,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/warning.html" } },
    condition: { urlFilter: `||${domain}^`, resourceTypes: ["main_frame"] },
  }));
}

/** Ids of every rule buildAthenaPolicyRules could ever produce, for clearing stale ones before re-adding. */
export function allAthenaPolicyRuleIds(): number[] {
  return Array.from({ length: MAX_ATHENA_POLICY_RULES }, (_, i) => ATHENA_POLICY_ID_START + i);
}
