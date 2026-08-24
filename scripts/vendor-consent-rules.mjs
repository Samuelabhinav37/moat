// Vendors Consent-O-Matic's (cavi-au, MIT-licensed) merged rule set for the
// major reusable cookie-consent platforms (OneTrust, Cookiebot, Didomi,
// Quantcast, TrustArc, Sourcepoint, etc.) -- a few dozen CMPs that between
// them power a large share of the web's cookie banners, as opposed to their
// separate 200+ per-site bespoke rule catalog, which trades much higher
// storage/maintenance cost for coverage of individual sites one at a time.
// Consumed at runtime by src/content/consentRejector.ts via a small,
// from-scratch interpreter (src/content/consent/) that supports the same
// action/matcher vocabulary Consent-O-Matic's own extension does, ported by
// hand from their Extension/*.js source -- see that directory's own
// comments for exactly what's included and what's deliberately left out.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "rules", "dnr");

const SOURCE_URL = "https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/Rules.json";

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to fetch Consent-O-Matic rules: ${response.status} ${response.statusText}`);
}
const text = await response.text();

let parsed;
try {
  parsed = JSON.parse(text);
} catch (err) {
  throw new Error(`Consent-O-Matic rules did not parse as JSON: ${err.message}`);
}

const cmpNames = Object.keys(parsed).filter((key) => key !== "$schema");
if (cmpNames.length === 0) {
  throw new Error("Consent-O-Matic rules parsed but contained no CMP entries -- refusing to ship an empty rule set.");
}
for (const name of cmpNames) {
  const cmp = parsed[name];
  if (!Array.isArray(cmp?.detectors) || !Array.isArray(cmp?.methods)) {
    throw new Error(`CMP "${name}" is missing detectors/methods -- rule format may have changed upstream.`);
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "consent-rules.json"), JSON.stringify(parsed));

console.log(`Vendored ${cmpNames.length} CMP rule set(s) -> rules/dnr/consent-rules.json`);
