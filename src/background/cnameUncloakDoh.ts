// Pure logic for Chrome's CNAME-uncloaking path (see background/
// cnameUncloakChrome.ts for the browser-API orchestration), pulled out so
// it's importable in tests without a browser environment -- same reasoning
// as cnameUncloakMatch.ts and customRules.ts.
import type { DeclarativeNetRequest } from "webextension-polyfill";
import { ALL_RESOURCE_TYPES } from "./customRules";

// Next free block after athenaPolicyRules.ts's 960_000 (see that file's own
// comment for the full reserved-range list: customRules.ts 800_000/810_000,
// liveRedirectRules.ts 900_000, quickFixRules.ts 950_000, athenaPolicyRules.ts
// 960_000).
export const CNAME_DOH_BLOCK_ID_START = 970_000;

// A session-scoped discovery list, not a growing blocklist -- capped small.
// Real cloaked-tracker subdomains are a handful per site at most; this isn't
// meant to accumulate the way the bundled static rules do.
export const MAX_CNAME_DOH_RULES = 200;

export function allCnameDohBlockRuleIds(): number[] {
  return Array.from({ length: MAX_CNAME_DOH_RULES }, (_, i) => CNAME_DOH_BLOCK_ID_START + i);
}

/** One block-everything rule per confirmed-cloak hostname discovered this
 * session. Unlike customRules.ts's user-authored domains, these are already
 * known-exact hostnames from a live DNS answer, not free-text input -- no
 * validation/sanitizing needed beyond what buildCnameDohBlockRules itself
 * does structurally (urlFilter takes the hostname as-is). */
export function buildCnameDohBlockRules(hostnames: string[]): DeclarativeNetRequest.Rule[] {
  return hostnames.slice(0, MAX_CNAME_DOH_RULES).map((hostname, index) => ({
    id: CNAME_DOH_BLOCK_ID_START + index,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: `||${hostname}^`, resourceTypes: ALL_RESOURCE_TYPES },
  }));
}

export interface DohAnswer {
  type: number;
  data: string;
}

export interface DohResponse {
  Answer?: DohAnswer[];
}

// DNS record type 5 is CNAME -- https://www.iana.org/assignments/dns-parameters
const DNS_TYPE_CNAME = 5;

/** Reads a CNAME target out of a DoH JSON response (RFC 8427 / Google's
 * and Cloudflare's shared `application/dns-json` shape), or null if there
 * isn't one. A trailing "." (the DNS root label, present in every raw DoH
 * answer) is stripped so the result compares directly against the plain
 * hostnames in cname-cloak-destinations.json the same way Firefox's
 * dns.resolve()'s canonicalName already does. */
export function parseDohCnameAnswer(body: DohResponse): string | null {
  const answer = body.Answer?.find((a) => a.type === DNS_TYPE_CNAME);
  if (!answer?.data) return null;
  return answer.data.replace(/\.$/, "");
}
