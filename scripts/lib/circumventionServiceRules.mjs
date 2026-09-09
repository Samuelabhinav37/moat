// Anti-adblock-circumvention service domains: vendors that sell publishers
// tooling specifically to defeat ad blockers (proxying/obfuscating ad
// requests so filter lists can't recognize them), distinct from ordinary ad
// networks. Curated in rules/circumvention-services.json (repo root, same
// hand-curated/git-tracked convention as ad-networks.json and
// seo-spam-domains.json) rather than sourced from AdGuard's bundled lists --
// a build-time audit of the vendored ads/trackers rulesets (ruleset_ads-*,
// ruleset_trackers-*) found neither addefend.com nor adthrive.com present as
// an actual block-rule domain. adthrive.com already appears in
// ad-networks.json, but only for adCollapse.ts's cosmetic empty-box
// collapse -- that hides the visual aftermath, it doesn't stop the
// circumvention script itself from running, which is the actual point here.
//
// Kept deliberately small: a false entry here would block a legitimate
// ad-tech vendor's unrelated traffic, so only domains independently
// confirmed (by name, not guessed) as circumvention-service vendors are
// listed. AdThrive rebranded to Raptive in 2023 (raptive.com) but its
// specific ad-serving subdomain under the new brand wasn't confirmed, so
// raptive.com is deliberately NOT added -- revisit once that's verifiable.
// Publica was named in the original research pass alongside AdThrive/
// AdDefend but no confirmable serving domain was found either; also
// deliberately excluded rather than guessed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const listPath = join(__dirname, "..", "..", "rules", "circumvention-services.json");

export function loadCircumventionServiceDomains() {
  return JSON.parse(readFileSync(listPath, "utf8"));
}

function domainBlockRule(id, domain) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: `||${domain}^`,
      // main_frame excluded: a direct navigation to one of these vendors'
      // own domains should still resolve, not hit a block -- same reasoning
      // ownTrackerRules' trackerBlockRule already uses.
      resourceTypes: [
        "sub_frame", "script", "image", "xmlhttprequest",
        "ping", "media", "websocket", "other",
      ],
    },
  };
}

export function buildCircumventionServiceRules(domains = loadCircumventionServiceDomains()) {
  return domains.map((domain, index) => domainBlockRule(index + 1, domain));
}
