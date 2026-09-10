import browser from "webextension-polyfill";
import {
  allCustomAllowRuleIds,
  allCustomBlockRuleIds,
  buildCustomAllowRules,
  buildCustomBlockRules,
} from "./customRules";
import type { Settings } from "../types";

export async function applyCustomRules(settings: Settings): Promise<void> {
  try {
    // One call, not two -- block and allow rule IDs are disjoint ranges
    // (customRules.ts), so there's nothing stopping this from being one
    // atomic update. Two separate calls would let the second one fail
    // (a dynamic-rule budget hit, shared across every other feature that
    // also uses dynamic rules -- CNAME uncloaking, live redirect domains,
    // quick fixes) after the first already landed, leaving block rules
    // updated to the user's new list while allow rules stay stuck on the
    // old one.
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [...allCustomBlockRuleIds(), ...allCustomAllowRuleIds()],
      addRules: [...buildCustomBlockRules(settings.customBlockedDomains), ...buildCustomAllowRules(settings.customAllowedDomains)],
    });
  } catch (err) {
    // Malformed domains are already filtered out before this call
    // (filterValidDomains, in customRules.ts), so reaching here means a
    // dynamic-rule budget hit or a real API failure -- the rest of the
    // extension shouldn't go down because of it, but it's worth a log line
    // instead of vanishing silently the way an unnamed catch would.
    console.warn("Moat: failed to apply custom rules", err);
  }
}
