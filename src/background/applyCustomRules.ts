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
  } catch {
    // Malformed domain entry or a dynamic-rule budget hit -- the rest of
    // the extension shouldn't go down because of a bad custom rule.
  }
}
