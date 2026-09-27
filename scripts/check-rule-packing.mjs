// Proves that packing (scripts/pack-rules.mjs) changed how the rules are
// stored and nothing about what they block. Loads two copies of the built
// extension into Chrome for Testing, one with the packed rulesets
// (dist/chrome) and one with the originals (rules/dnr-unpacked/), turns
// every ruleset on in both, and asks Chrome itself
// (declarativeNetRequest.testMatchOutcome) what it would do with requests
// to every domain any rule names: from a third-party page and from the
// site itself, across request types. Every answer must match: the same
// action (block, allow, redirect, ...) from the same ruleset.
//
//   npm run build:chrome && node scripts/check-rule-packing.mjs [--sample N]
//
// Exits 1 on any difference. --sample checks every Nth domain (CI uses a
// sample to stay fast; the full run takes a few minutes).
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "./chrome-for-testing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packedExt = join(root, "dist", "chrome");
const unpackedRules = join(root, "rules", "dnr-unpacked");
const sampleArg = process.argv.indexOf("--sample");
const every = sampleArg > 0 ? Math.max(1, Number(process.argv[sampleArg + 1]) || 1) : 1;

if (!existsSync(join(packedExt, "manifest.json"))) throw new Error('dist/chrome is missing. Run "npm run build:chrome" first.');
if (!existsSync(join(unpackedRules, "manifest.json"))) throw new Error("rules/dnr-unpacked is missing. Run scripts/pack-rules.mjs first.");

// The same extension with the original rulesets swapped in.
const work = mkdtempSync(join(tmpdir(), "moat-packcheck-"));
const unpackedExt = join(work, "ext");
cpSync(packedExt, unpackedExt, { recursive: true });
const unpackedManifest = JSON.parse(readFileSync(join(unpackedRules, "manifest.json"), "utf8"));
for (const entry of unpackedManifest) cpSync(join(unpackedRules, entry.file), join(unpackedExt, "rules", entry.file));

// Every domain any rule names, from the original rulesets.
const domains = new Set();
const HOST = /^\|\|([a-z0-9.-]+)/;
for (const entry of unpackedManifest) {
  for (const rule of JSON.parse(readFileSync(join(unpackedRules, entry.file), "utf8"))) {
    const c = rule.condition ?? {};
    const m = HOST.exec(c.urlFilter ?? "");
    if (m) domains.add(m[1].replace(/\.$/, ""));
    for (const d of c.requestDomains ?? []) domains.add(d);
    for (const d of c.initiatorDomains ?? []) domains.add(d);
  }
}
// Filter syntax can name things that aren't host names (wildcards, "_");
// Chrome rejects those as URLs, so they can't be asked about.
const VALID_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]*[a-z0-9]$/;
for (const domain of domains) if (!VALID_HOST.test(domain)) domains.delete(domain);
const TYPES = ["script", "image", "xmlhttprequest", "sub_frame", "main_frame", "stylesheet", "media", "font", "ping", "other"];
const tests = [];
[...domains].sort().forEach((domain, i) => {
  if (i % every !== 0) return;
  // A subdomain from a third-party page, and the domain itself from its own site.
  // IP addresses (and IP-range prefixes) have no subdomains.
  const sub = /^[\d.]+$/.test(domain) ? domain : `moatcheck.${domain}`;
  tests.push({ url: `https://${sub}/x`, type: TYPES[i % TYPES.length], initiator: "https://moat-first-party.test" });
  tests.push({ url: `https://${domain}/`, type: TYPES[(i + 5) % TYPES.length], initiator: `https://${domain}` });
});
console.log(`${domains.size.toLocaleString()} domains, ${tests.length.toLocaleString()} requests to check in each build`);

// ruleset:ruleId -> what the rule does, for turning matches into outcomes.
function actionTable(dir, manifest) {
  const table = new Map();
  for (const entry of manifest) {
    for (const rule of JSON.parse(readFileSync(join(dir, entry.file), "utf8"))) {
      const a = rule.action;
      const detail = a.redirect?.extensionPath ?? a.redirect?.url ?? a.redirect?.regexSubstitution ?? (a.redirect?.transform ? JSON.stringify(a.redirect.transform) : "");
      table.set(`${entry.id}:${rule.id}`, `${a.type}${detail ? ` ${detail}` : ""}${a.requestHeaders || a.responseHeaders ? " headers" : ""}`);
    }
  }
  return table;
}

async function outcomes(extDir, table) {
  const profile = mkdtempSync(join(tmpdir(), "moat-packcheck-profile-"));
  const browser = await puppeteer.launch({ executablePath: await chromePath(root), headless: true, pipe: true, userDataDir: profile, enableExtensions: [extDir],
    // GitHub's Linux runners can't use Chrome's sandbox (same as check-chrome-load.mjs).
    args: process.env.CI ? ["--no-sandbox"] : [] });
  try {
    const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"), { timeout: 60000 });
    const worker = await target.worker();
    // Let Moat's own startup apply its settings, then turn every ruleset on.
    await new Promise((r) => setTimeout(r, 6000));
    await worker.evaluate(async () => {
      const ids = chrome.runtime.getManifest().declarative_net_request.rule_resources.map((r) => r.id);
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ids });
    });
    const enabled = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
    const result = [];
    const BATCH = 4000;
    for (let i = 0; i < tests.length; i += BATCH) {
      const batch = tests.slice(i, i + BATCH);
      const matched = await worker.evaluate(async (batch) => {
        return Promise.all(
          batch.map((t) =>
            chrome.declarativeNetRequest
              .testMatchOutcome(t)
              .then((r) => r.matchedRules.map((m) => `${m.rulesetId}:${m.ruleId}`))
              .catch((e) => [`error: ${e.message}`])
          )
        );
      }, batch);
      for (const refs of matched) {
        result.push(
          refs
            .map((ref) => (ref.startsWith("error") ? ref : `${ref.split(":")[0]} ${table.get(ref) ?? "?"}`))
            .sort()
            .join(" | ") || "none"
        );
      }
    }
    return { result, enabled: enabled.length };
  } finally {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

const started = Date.now();
const packedManifest = JSON.parse(readFileSync(join(packedExt, "rules", "manifest.json"), "utf8"));
const before = await outcomes(unpackedExt, actionTable(join(unpackedExt, "rules"), unpackedManifest));
const after = await outcomes(packedExt, actionTable(join(packedExt, "rules"), packedManifest));
rmSync(work, { recursive: true, force: true });

let differences = 0;
const tally = new Map();
before.result.forEach((outcome, i) => {
  const kind = outcome === "none" ? "none" : outcome.split(" | ").map((o) => o.split(" ")[1]).join("+");
  tally.set(kind, (tally.get(kind) ?? 0) + 1);
  if (outcome !== after.result[i]) {
    differences++;
    if (differences <= 20) console.log(`DIFF ${tests[i].type} ${tests[i].url} (from ${tests[i].initiator})\n  unpacked: ${outcome}\n  packed:   ${after.result[i]}`);
  }
});
before.result.forEach((o, i) => {
  if (o.includes("error") && process.env.SHOW_ERRORS) console.log(`ERR ${tests[i].type} ${tests[i].url} ${o}`);
});
const errors = after.result.filter((o) => o.includes("error")).length + before.result.filter((o) => o.includes("error")).length;
console.log(`rulesets enabled: unpacked ${before.enabled}, packed ${after.enabled}`);
console.log(`outcomes (unpacked): ${[...tally].map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ")}`);
console.log(`${differences.toLocaleString()} differences, ${errors} errors, in ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(differences === 0 && errors === 0 && before.enabled === after.enabled ? 0 : 1);
