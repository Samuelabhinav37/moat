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
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allCustomBlockRuleIds(),
      addRules: buildCustomBlockRules(settings.customBlockedDomains),
    });
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allCustomAllowRuleIds(),
      addRules: buildCustomAllowRules(settings.customAllowedDomains),
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
