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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchAndVendor } from "./lib/vendorFetch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = join(__dirname, "..", "rules", "dnr", "consent-rules.json");

const SOURCE_URL = "https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/Rules.json";

// The exact closed vocabulary src/content/consent/types.ts's ActionConfig
// union recognizes. Kept in sync by hand with that file -- there's no
// runtime import across the TS/plain-Node-ESM boundary here, so if this
// list and types.ts drift, this check either false-flags a real action type
// (safe: build fails loudly) or misses a new one types.ts already added
// (safe: the interpreter's own unknown-action no-op still covers it). Either
// way this check exists to catch an *upstream* Consent-O-Matic action type
// none of our own code has ever seen, not to replace types.ts.
const KNOWN_ACTION_TYPES = new Set([
  "click",
  "multiclick",
  "list",
  "consent",
  "ifcss",
  "waitcss",
  "foreach",
  "hide",
  "close",
  "wait",
  "ifallowall",
  "ifallownone",
  "runrooted",
  "runmethod",
  "slide", // recognized-but-unsupported: the interpreter safely no-ops on it.
]);

/** Walks every action reachable from a MethodConfig.action, including the
 * nested ones inside list/consent/ifcss/waitcss/foreach/runrooted/
 * ifallowall/ifallownone, collecting any action `type` outside
 * KNOWN_ACTION_TYPES. */
function collectUnknownActionTypes(action, unknown) {
  if (!action || typeof action !== "object") return;

  if (typeof action.type === "string" && !KNOWN_ACTION_TYPES.has(action.type)) {
    unknown.add(action.type);
  }

  if (Array.isArray(action.actions)) {
    for (const child of action.actions) collectUnknownActionTypes(child, unknown);
  }
  if (Array.isArray(action.consents)) {
    for (const consent of action.consents) {
      collectUnknownActionTypes(consent?.toggleAction, unknown);
      collectUnknownActionTypes(consent?.trueAction, unknown);
      collectUnknownActionTypes(consent?.falseAction, unknown);
    }
  }
  collectUnknownActionTypes(action.trueAction, unknown);
  collectUnknownActionTypes(action.falseAction, unknown);
  collectUnknownActionTypes(action.action, unknown); // foreach, runrooted
}

const parsed = await fetchAndVendor({
  url: SOURCE_URL,
  describe: "Consent-O-Matic rules",
  outFile,
  parse: (text) => JSON.parse(text),
  validate: (parsed) => {
    const cmpNames = Object.keys(parsed).filter((key) => key !== "$schema");
    if (cmpNames.length === 0) {
      throw new Error("Consent-O-Matic rules parsed but contained no CMP entries -- refusing to ship an empty rule set.");
    }

    const unknownActionTypes = new Set();
    for (const name of cmpNames) {
      const cmp = parsed[name];
      if (!Array.isArray(cmp?.detectors) || !Array.isArray(cmp?.methods)) {
        throw new Error(`CMP "${name}" is missing detectors/methods -- rule format may have changed upstream.`);
      }
      for (const method of cmp.methods) {
        collectUnknownActionTypes(method?.action, unknownActionTypes);
      }
    }
    if (unknownActionTypes.size > 0) {
      throw new Error(
        `Consent-O-Matic rules contain action type(s) our interpreter doesn't know about: ${[...unknownActionTypes].join(", ")}. ` +
          "Add support in src/content/consent/ (types.ts/actions.ts/engine.ts) and this file's KNOWN_ACTION_TYPES before vendoring, " +
          "or confirm the interpreter's existing unknown-action no-op is an acceptable outcome for it and update this allowlist."
      );
    }
  },
});

const cmpCount = Object.keys(parsed).filter((key) => key !== "$schema").length;
console.log(`Vendored ${cmpCount} CMP rule set(s) -> rules/dnr/consent-rules.json`);
