// Copies prebuilt AdGuard DNR rulesets out of node_modules into rules/dnr/.
// Re-run whenever @adguard/dnr-rulesets is updated (npm run filters:update).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chunkBySize } from "./lib/chunkBySize.mjs";
import { resolveRedirectResource } from "./lib/redirectResources.mjs";
import { extractRuleDomain, lookupCompany } from "./lib/ruleCompany.mjs";
import { pruneRedundantRules } from "./lib/pruneRedundantRules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sourceDir = join(
  root,
  "node_modules/@adguard/dnr-rulesets/dist/filters/chromium-mv3/declarative"
);
const outDir = join(root, "rules/dnr");
const redirectResourcesSourceDir = join(
  root,
  "node_modules/@adguard/scriptlets/dist/redirect-files"
);
const redirectResourcesOutDir = join(root, "rules/redirect-resources");
const trackerDbPath = join(root, "node_modules/@ghostery/trackerdb/dist/trackerdb.json");
const trackerDb = existsSync(trackerDbPath) ? JSON.parse(readFileSync(trackerDbPath, "utf8")) : null;

// AdGuard filter IDs. See https://filters.adtidy.org/extension/chromium-mv3/filters.json
// `category` groups these for the Filter Lists settings tab: "ads" (ads/trackers/redirects),
// "security" (known-malicious domains, not just ads), "annoyance" (widgets/banners/notices).
const RULESETS = [
  // Ads / redirects
  { id: 2, slug: "ads", name: "AdGuard Base filter", category: "ads", enabled: true },
  { id: 3, slug: "trackers", name: "AdGuard Tracking Protection filter", category: "ads", enabled: true },
  { id: 17, slug: "url-tracking", name: "AdGuard URL Tracking filter", category: "ads", enabled: true },
  { id: 19, slug: "popups", name: "AdGuard Popups filter", category: "ads", enabled: true },
  // Security -- known-malicious domains, not just ads.
  { id: 208, slug: "malicious-urls", name: "Online Malicious URL Blocklist", category: "security", enabled: true },
  { id: 255, slug: "phishing-urls", name: "Phishing URL Blocklist", category: "security", enabled: true },
  { id: 256, slug: "scam", name: "Scam Blocklist", category: "security", enabled: true },
  { id: 257, slug: "badware", name: "uBlock Origin - Badware risks", category: "security", enabled: true },
  // Additional privacy / annoyance coverage.
  { id: 4, slug: "social-widgets", name: "AdGuard Social Media filter", category: "annoyance", enabled: true },
  { id: 18, slug: "cookie-notices", name: "AdGuard Cookie Notices filter", category: "annoyance", enabled: true },
  { id: 21, slug: "annoyances", name: "AdGuard Other Annoyances filter", category: "annoyance", enabled: true },
];

if (!existsSync(sourceDir)) {
  console.error(
    `Ruleset source not found at ${sourceDir}. Run "npm install" first.`
  );
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
rmSync(redirectResourcesOutDir, { recursive: true, force: true });
mkdirSync(redirectResourcesOutDir, { recursive: true });

const availableRedirectResources = existsSync(redirectResourcesSourceDir)
  ? new Set(readdirSync(redirectResourcesSourceDir))
  : new Set();
const neededRedirectResources = new Set();
let droppedRedirectRules = 0;

// Rulesets whose "block this whole domain" rules also feed the background
// safety net that closes popup/redirect tabs (see background/popupGuard.ts).
// Kept separate from the DNR rulesets themselves, which only Chrome/Firefox's
// network layer reads.
const REDIRECT_DOMAIN_SOURCES = new Set(["popups", "url-tracking"]);
const domainAnchor = /^\|\|([a-z0-9.-]+)\^?\$?$/;
const redirectDomains = new Set();

const manifestEntries = [];
// rulesetId (the same string used as manifestEntries[].id, which is what
// declarativeNetRequest.getMatchedRules() returns as MatchedRuleInfo.rule.rulesetId
// at runtime) -> ruleId -> company name, for the popup's optional "by company"
// breakdown (see src/background/matchStats.ts). Sourced from Ghostery's
// TrackerDB (@ghostery/trackerdb's dist/trackerdb.json, CC-BY-NC-SA-4.0 --
// see README's Licensing note), correlated by domain at build time so no
// runtime domain matching or third-party engine is needed.
const ruleCompanies = {};

for (const ruleset of RULESETS) {
  const srcPath = join(
    sourceDir,
    `ruleset_${ruleset.id}`,
    `ruleset_${ruleset.id}.json`
  );
  const rawRules = JSON.parse(readFileSync(srcPath, "utf8"));

  const cleaned = [];
  for (const rule of rawRules) {
    // Rules that redirect to a bundled no-op resource (extensionPath) need a
    // matching file shipped as a web-accessible resource. @adguard/scriptlets
    // ships exactly the resource files AdGuard's own rules reference, so
    // resolve against that instead of dropping the whole slice -- only drop
    // a rule if the specific resource it points at genuinely isn't shipped.
    if (rule.action?.type === "redirect" && rule.action.redirect?.extensionPath) {
      const resource = resolveRedirectResource(rule.action.redirect.extensionPath, availableRedirectResources);
      if (!resource) {
        droppedRedirectRules += 1;
        continue;
      }
      neededRedirectResources.add(resource);
    }
    // Only {id, priority, action, condition} are part of the DNR rule
    // schema. AdGuard's ruleset id 1 in particular carries a multi-MB
    // debug-only metadata blob that Chrome/Firefox don't expect.
    cleaned.push({
      id: rule.id,
      priority: rule.priority,
      action: rule.action,
      condition: rule.condition,
    });

    if (REDIRECT_DOMAIN_SOURCES.has(ruleset.slug) && rule.action?.type === "block") {
      const resourceTypes = rule.condition?.resourceTypes;
      const coversMainFrame = !resourceTypes || resourceTypes.includes("main_frame");
      const match = coversMainFrame ? domainAnchor.exec(rule.condition?.urlFilter ?? "") : null;
      if (match) redirectDomains.add(match[1]);
    }
  }

  // Drop rules already fully redundant within this same ruleset -- a rule
  // blocking "sub.example.com" blocks nothing an existing "example.com"
  // rule (same resourceTypes) doesn't already cover, since declarativeNetRequest's
  // "||" domain anchor matches every subdomain on its own. Verified as a
  // real, zero-risk (no change in what's actually blocked) reduction via
  // scripts/analysis/consolidation-audit.mjs; see
  // docs/research/dnr-rule-consolidation-audit.md and pruneRedundantRules.mjs's
  // own header for why this is scoped to non-security rulesets only --
  // "security" rulesets block arbitrary hosted bad content, and the
  // *domain-ownership* reasoning this prune relies on for ads/trackers
  // doesn't apply the same way there (it doesn't create new blocking scope
  // the way the riskier sibling-subdomain consolidation would, so this
  // exclusion is about staying consistent with that reasoning, not a
  // required safety boundary the way it is for Finding 2).
  let redundantDropped = 0;
  if (ruleset.category !== "security") {
    const pruned = pruneRedundantRules(cleaned);
    redundantDropped = pruned.droppedCount;
    cleaned.length = 0;
    cleaned.push(...pruned.kept);
  }

  // Firefox's linter (the same one AMO's automated review runs) refuses to
  // parse any non-binary file over 5MB, which the base/tracking rulesets
  // blow past on their own. Split into same-sized-budget chunks so every
  // file it has to look at stays under that ceiling.
  const MAX_CHUNK_BYTES = 4.5 * 1024 * 1024;
  const chunks = chunkBySize(cleaned, MAX_CHUNK_BYTES);

  chunks.forEach((chunkRules, index) => {
    const suffix = chunks.length > 1 ? `-${index + 1}` : "";
    const outFile = `ruleset_${ruleset.slug}${suffix}.json`;
    const rulesetId = `ruleset_${ruleset.slug}${suffix}`;
    writeFileSync(join(outDir, outFile), JSON.stringify(chunkRules));

    // "security" rulesets (malicious-urls, phishing-urls, scam, badware)
    // block arbitrary bad *content* wherever it's hosted -- often a phishing
    // page parked on a free platform (github.io, weebly.com, etc.). Domain-
    // chain-walking those up to the platform's own registrable domain would
    // misattribute the block to the platform itself (confirmed live: 6,303
    // malicious-urls rules and 4,344 phishing-urls rules would otherwise
    // land on "GitHub, Inc." and "Weebly"). Only ad/tracking rulesets, where
    // the blocked domain genuinely is the tracker's own infrastructure, are
    // eligible for company attribution.
    if (trackerDb && ruleset.category !== "security") {
      for (const rule of chunkRules) {
        const domain = extractRuleDomain(rule.condition?.urlFilter);
        const company = domain ? lookupCompany(domain, trackerDb) : null;
        if (!company) continue;
        (ruleCompanies[rulesetId] ??= {})[rule.id] = company;
      }
    }

    manifestEntries.push({
      id: rulesetId,
      group: ruleset.slug,
      category: ruleset.category,
      name: chunks.length > 1 ? `${ruleset.name} (${index + 1}/${chunks.length})` : ruleset.name,
      enabled: ruleset.enabled,
      file: outFile,
      ruleCount: chunkRules.length,
    });
  });

  console.log(
    `${ruleset.name}: ${cleaned.length}/${rawRules.length} rules kept across ${chunks.length} file(s)` +
      (redundantDropped > 0 ? ` (${redundantDropped} already-redundant rule(s) pruned)` : "")
  );
}

// Our own rule, not sourced from AdGuard: attach the Global Privacy Control
// signal to every outgoing request. As of 2026 several US states treat GPC
// as a legally binding opt-out, so this has real effect beyond the header
// itself (see also navigator.globalPrivacyControl in mainWorldGuard.ts).
const ownPrivacyRules = [
  {
    id: 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Sec-GPC", operation: "set", value: "1" }],
    },
    condition: {
      resourceTypes: [
        "main_frame",
        "sub_frame",
        "stylesheet",
        "script",
        "image",
        "font",
        "object",
        "xmlhttprequest",
        "ping",
        "csp_report",
        "media",
        "websocket",
        "webtransport",
        "webbundle",
        "other",
      ],
    },
  },
];
writeFileSync(join(outDir, "ruleset_privacy-headers.json"), JSON.stringify(ownPrivacyRules));
manifestEntries.push({
  id: "ruleset_privacy-headers",
  group: "privacy-headers",
  // Not a user-toggleable filter list -- the Filter Lists UI skips anything
  // in the "core" category, since turning this off has no meaningful
  // "less filtering" effect for the user, it just stops sending GPC.
  category: "core",
  name: "Moat: Global Privacy Control header",
  enabled: true,
  file: "ruleset_privacy-headers.json",
  ruleCount: ownPrivacyRules.length,
});

// Our own rules, not sourced from AdGuard: domain-scoped tracking-param
// stripping for gaps identified against ClearURLs
// (docs/research/clearurls-gap-audit.md, Finding 3) that AdGuard's bundled
// URL Tracking filter doesn't cover on these specific high-traffic
// first-party domains. Kept in a first-party file rather than hand-edited
// into ruleset_url-tracking.json above, which is regenerated wholesale from
// AdGuard's source every run -- same reasoning as ruleset_privacy-headers.json.
// Google's `ie` and `dpr` are deliberately excluded from this list: unlike
// the rest, they aren't obviously tracking-only by name alone, and the audit
// flagged that ClearURLs stripping them isn't enough justification on its
// own without independent confirmation.
function domainRemoveParamsRule(id, urlFilter, removeParams) {
  return {
    id,
    priority: 1,
    action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams } } } },
    condition: { urlFilter, resourceTypes: ["main_frame", "sub_frame"] },
  };
}

const ownUrlTrackingRules = [
  domainRemoveParamsRule(1, "||google.*/search", [
    "esrc", "uact", "cd", "cad", "atyp", "vet", "_u", "je", "dcr", "sei",
    "usg", "sxsrf", "rlz", "ictx", "cshid",
  ]),
  domainRemoveParamsRule(2, "||facebook.com^", [
    "eid", "comment_tracking", "dti", "app", "video_source", "ftentidentifier",
    "pageid", "padding", "ls_ref", "action_history", "referral_code",
    "referral_story_type", "eav", "sfnsn", "idorvanity", "wtsid", "rdr",
    "paipv", "_nc_x", "_rdr",
  ]),
  domainRemoveParamsRule(3, "||amazon.*", [
    "spIA", "ms3_c", "qualifier", "_encoding", "aaxitk", "hsa_cr_id", "rnid",
    "content-id", "social_share", "starsLeft", "skipTwisterOG",
  ]),
  domainRemoveParamsRule(4, "||bing.com^", ["sp", "qs", "qp"]),
  domainRemoveParamsRule(5, "||twitter.com^", ["cn"]),
  domainRemoveParamsRule(6, "||x.com^", ["cn"]),
  domainRemoveParamsRule(7, "||reddit.com^", ["rdt"]),
  domainRemoveParamsRule(8, "||twitch.tv^", ["tt_medium", "tt_content"]),
  domainRemoveParamsRule(9, "||youtube.com^", ["kw"]),
];
writeFileSync(join(outDir, "ruleset_url-tracking-extra.json"), JSON.stringify(ownUrlTrackingRules));
// Same group as the AdGuard URL Tracking filter above so this merges into
// that one Filter Lists toggle (see summarizeFilterLists) instead of adding
// a second, redundant-looking row for what's conceptually the same feature.
manifestEntries.push({
  id: "ruleset_url-tracking-extra",
  group: "url-tracking",
  category: "ads",
  name: "Moat: URL Tracking filter (ClearURLs gap fixes)",
  enabled: true,
  file: "ruleset_url-tracking-extra.json",
  ruleCount: ownUrlTrackingRules.length,
});

// Our own rules, not sourced from AdGuard: plain block rules for a handful
// of error-reporting and social ad/conversion endpoints the bundled lists
// verifiably miss (docs/research/competitive-gap-audit.md, section 3f).
// Each was checked against the shipped rulesets:
//   - Bugsnag notify/sessions and the Sentry ingest hosts have no
//     domain-anchored rule at all; sentry-cdn.com and bugsnag.com are only
//     blocked behind an `adblock-tester.com` initiator, i.e. a test-page
//     rule that never fires on a real site.
//   - an.facebook.com (Audience Network) is only touched by a param-strip
//     redirect on ||facebook.com^, which neither blocks nor matches the
//     subdomain.
//   - ads.pinterest.com is nominally caught by AdGuard's generic `://ads.`
//     rule, but that rule excludes the `image` and `xmlhttprequest` types --
//     exactly how the Pinterest tag phones home.
// Scoped to the telemetry hostnames, not the vendors' own dashboards
// (app.bugsnag.com, sentry.io), so using those products is unaffected.
// `main_frame` is deliberately left out of resourceTypes: a direct
// navigation to one of these hosts should still resolve, not hit a block.
// Kept in a first-party file for the same reason as the two rulesets above
// -- ruleset_trackers-*.json is regenerated wholesale from AdGuard each run.
function trackerBlockRule(id, urlFilter) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter,
      resourceTypes: [
        "sub_frame", "script", "image", "xmlhttprequest",
        "ping", "media", "websocket", "other",
      ],
    },
  };
}

const ownTrackerRules = [
  trackerBlockRule(1, "||notify.bugsnag.com^"),
  trackerBlockRule(2, "||sessions.bugsnag.com^"),
  // ||ingest.sentry.io^ matches the oNNNNN.ingest[.region].sentry.io hosts
  // real DSNs use -- `||` anchors the (sub)domain, not just the exact label.
  trackerBlockRule(3, "||ingest.sentry.io^"),
  trackerBlockRule(4, "||ingest.us.sentry.io^"),
  trackerBlockRule(5, "||ingest.de.sentry.io^"),
  trackerBlockRule(6, "||sentry-cdn.com^"),
  trackerBlockRule(7, "||an.facebook.com^"),
  trackerBlockRule(8, "||ads.pinterest.com^"),
];
writeFileSync(join(outDir, "ruleset_trackers-extra.json"), JSON.stringify(ownTrackerRules));
// Same group as the AdGuard Tracking Protection filter above so it folds
// into that one Filter Lists row (see summarizeFilterLists) and the popup's
// "trackers" bucket (see matchedRuleCategories.ts), rather than adding a
// separate row for what is conceptually the same list.
manifestEntries.push({
  id: "ruleset_trackers-extra",
  group: "trackers",
  category: "ads",
  name: "Moat: Tracking Protection filter (coverage-gap fixes)",
  enabled: true,
  file: "ruleset_trackers-extra.json",
  ruleCount: ownTrackerRules.length,
});

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(manifestEntries, null, 2)
);
const redirectDomainsJson = JSON.stringify([...redirectDomains].sort());
writeFileSync(join(outDir, "redirect-domains.json"), redirectDomainsJson);

// Also written to a *tracked* path (unlike rules/dnr/, which is gitignored
// build output): the background worker polls this file straight off
// raw.githubusercontent.com (see background/liveUpdates.ts), so whatever's
// committed here is live within ~a day for every installed copy of the
// extension, without needing a new store release. Publishing a refresh is
// just: run this script, commit live/redirect-domains.json, push -- no
// scheduled/unattended automation writes to the repo on its own.
const liveDir = join(root, "live");
mkdirSync(liveDir, { recursive: true });
writeFileSync(join(liveDir, "redirect-domains.json"), redirectDomainsJson);

writeFileSync(join(outDir, "rule-companies.json"), JSON.stringify(ruleCompanies));

// Copy only the resource files $redirect rules actually reference (not
// every file @adguard/scriptlets ships) into a tracked-shaped build output,
// mirrored by scripts/build.mjs into web-accessible-resources/redirects/ so
// the extensionPath values already baked into the rules above resolve as-is.
for (const name of neededRedirectResources) {
  cpSync(join(redirectResourcesSourceDir, name), join(redirectResourcesOutDir, name));
}

const total = manifestEntries.reduce((sum, r) => sum + r.ruleCount, 0);
console.log(`\nWrote ${manifestEntries.length} rulesets, ${total} total rules -> rules/dnr/`);
console.log(`Extracted ${redirectDomains.size} known ad-redirect domains -> rules/dnr/redirect-domains.json and live/redirect-domains.json`);
console.log(
  `Kept ${neededRedirectResources.size} $redirect resource file(s) -> rules/redirect-resources/` +
    (droppedRedirectRules > 0
      ? ` (${droppedRedirectRules} $redirect rule(s) still dropped -- referenced resource(s) not shipped by @adguard/scriptlets)`
      : "")
);
const attributedRuleCount = Object.values(ruleCompanies).reduce((sum, m) => sum + Object.keys(m).length, 0);
console.log(
  trackerDb
    ? `Attributed ${attributedRuleCount} rules to a company via TrackerDB -> rules/dnr/rule-companies.json`
    : "TrackerDB not found (npm install @ghostery/trackerdb) -- skipped company attribution"
);
