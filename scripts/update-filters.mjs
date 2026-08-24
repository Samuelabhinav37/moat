// Copies prebuilt AdGuard DNR rulesets out of node_modules into rules/dnr/.
// Re-run whenever @adguard/dnr-rulesets is updated (npm run filters:update).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chunkBySize } from "./lib/chunkBySize.mjs";
import { resolveRedirectResource } from "./lib/redirectResources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sourceDir = join(
  root,
  "node_modules/@adguard/dnr-rulesets/dist/filters/declarative"
);
const outDir = join(root, "rules/dnr");
const redirectResourcesSourceDir = join(
  root,
  "node_modules/@adguard/scriptlets/dist/redirect-files"
);
const redirectResourcesOutDir = join(root, "rules/redirect-resources");

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

  // Firefox's linter (the same one AMO's automated review runs) refuses to
  // parse any non-binary file over 5MB, which the base/tracking rulesets
  // blow past on their own. Split into same-sized-budget chunks so every
  // file it has to look at stays under that ceiling.
  const MAX_CHUNK_BYTES = 4.5 * 1024 * 1024;
  const chunks = chunkBySize(cleaned, MAX_CHUNK_BYTES);

  chunks.forEach((chunkRules, index) => {
    const suffix = chunks.length > 1 ? `-${index + 1}` : "";
    const outFile = `ruleset_${ruleset.slug}${suffix}.json`;
    writeFileSync(join(outDir, outFile), JSON.stringify(chunkRules));

    manifestEntries.push({
      id: `ruleset_${ruleset.slug}${suffix}`,
      group: ruleset.slug,
      category: ruleset.category,
      name: chunks.length > 1 ? `${ruleset.name} (${index + 1}/${chunks.length})` : ruleset.name,
      enabled: ruleset.enabled,
      file: outFile,
      ruleCount: chunkRules.length,
    });
  });

  console.log(
    `${ruleset.name}: ${cleaned.length}/${rawRules.length} rules kept across ${chunks.length} file(s)`
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
