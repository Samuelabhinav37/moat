/**
 * Top-level driver, ported from the relevant slice of Consent-O-Matic's
 * ConsentEngine.js (https://github.com/cavi-au/Consent-O-Matic/blob/master/
 * Extension/ConsentEngine.js, MIT-licensed): given a detected-and-showing
 * CMP, run HIDE_CMP -> OPEN_OPTIONS -> HIDE_CMP -> DO_CONSENT -> SAVE_CONSENT
 * with every consent category defaulted to reject (types.ts's REJECT_ALL --
 * Consent-O-Matic's own out-of-the-box default too, not a stricter policy
 * Moat invented).
 *
 * Left out entirely, all UI/orchestration chrome for Consent-O-Matic's own
 * extension that Moat has no equivalent of: the progress dialog, click/
 * statistics counters, and the indefinite 500ms-interval + MutationObserver
 * background rescan loop that keeps watching for a next CMP after handling
 * one. This module does one bounded check of the current DOM snapshot and
 * returns; src/content/consentRejector.ts owns retrying on a time budget
 * as the page's own banner mounts asynchronously.
 */
import { Cmp } from "./cmp";
import { newContext } from "./tools";
import { REJECT_ALL, type CmpConfig, type RuleSet } from "./types";

function buildCmps(ruleSet: RuleSet): Cmp[] {
  const cmps: Cmp[] = [];
  for (const [name, config] of Object.entries(ruleSet)) {
    if (name === "$schema" || typeof config !== "object" || config === null) continue;
    try {
      cmps.push(new Cmp(name, config as CmpConfig));
    } catch {
      // Malformed CMP entry -- skip it and keep going, same as
      // Consent-O-Matic's own per-CMP try/catch when building its CMP list.
    }
  }
  return cmps;
}

export interface ConsentRunResult {
  handled: boolean;
  cmpName?: string;
}

/** One snapshot attempt: is a CMP present and showing right now? If so,
 * run the full reject sequence against it and report which one. Safe to
 * call repeatedly (e.g. on a MutationObserver/interval) until it reports
 * handled: true or a caller-owned time budget runs out. */
export async function runConsentRejection(ruleSet: RuleSet): Promise<ConsentRunResult> {
  const cmps = buildCmps(ruleSet);
  const ctx = newContext(null);
  const cmp = cmps.find((c) => c.isPresent(ctx) && c.isShowing(ctx));
  if (cmp == null) return { handled: false };

  await cmp.runMethod("HIDE_CMP", REJECT_ALL, ctx);
  await cmp.runMethod("OPEN_OPTIONS", REJECT_ALL, ctx);
  await cmp.runMethod("HIDE_CMP", REJECT_ALL, ctx);
  await cmp.runMethod("DO_CONSENT", REJECT_ALL, ctx);
  await cmp.runMethod("SAVE_CONSENT", REJECT_ALL, ctx);

  return { handled: true, cmpName: cmp.name };
}
