// "Block like a router" (opt-in, off until switched on in Settings › Filter
// lists): the ad and tracker lists' plainly blocked domains also stop as a
// page you open, the way a DNS blocker does. Every other rule skips
// main_frame, so a pop-under or ad landing page opened straight from a link
// still loads. Pages show Moat's block page with "Open anyway".
//
// Only AdGuard's ad and tracker lists and Moat's own extras feed it. Peter
// Lowe, oisd and Privacy Badger stay out: their page blocks broke email
// click-trackers (field report 2026-10-14, 0.11.279). Shared link hosts are
// left out the same way the security lists leave them out.
import { plainBlockedDomains } from "../../src/shared/blockedDomains.ts";
import { withoutSharedLinkBlocks } from "./linkRules.mjs";
import { DOMAINS_PER_PACKED_RULE } from "./packDomainRules.mjs";

export const AD_PAGES_GROUP = "ad-pages";

/** Ruleset ids whose domains feed the page rules. */
export function isAdPageSource(entry) {
  return (entry.group === "ads" || entry.group === "trackers") && !/^ruleset_(peter-lowe|pb-trackers)/.test(entry.id);
}

/** main_frame blocks for the domains, already packed: one rule per
 * domain is over Chrome's rule limit before pack-rules.mjs runs, which
 * check-rule-packing.mjs loads with every list on. */
export function buildAdPageRules(rulesets) {
  const domains = new Set();
  for (const rules of rulesets) for (const domain of plainBlockedDomains(rules)) domains.add(domain);
  const sorted = [...domains].sort();
  const out = [];
  for (let i = 0; i < sorted.length; i += DOMAINS_PER_PACKED_RULE) {
    const rule = withoutSharedLinkBlocks({ action: { type: "block" }, condition: { requestDomains: sorted.slice(i, i + DOMAINS_PER_PACKED_RULE), resourceTypes: ["main_frame"] } });
    if (rule) out.push({ id: out.length + 1, priority: 1, ...rule });
  }
  return out;
}
