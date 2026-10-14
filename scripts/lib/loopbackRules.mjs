import { QUICK_FIX_PRIORITY } from "../../src/shared/rulePriorities.ts";
import { LOOPBACK_REQUEST_DOMAINS } from "../../src/shared/loopback.ts";

// This computer's own addresses (see src/shared/loopback.ts): a terminal
// sign-in's localhost callback, a local dev server. Two rules, in the live
// quick-fix band like the compat allowances: above every bundled ad, tracker
// and header rule (so no block and no Sec-GPC header), below "Never block",
// pause and the security lists.
//   - requests *to* loopback from any page (Privacy Badger's ignore.json),
//   - everything a page *on* loopback loads, as a pause does.
export const LOOPBACK_PRIORITY = QUICK_FIX_PRIORITY;

/** The two loopback rules, ids `firstId` and `firstId + 1`. */
export function buildLoopbackRules(firstId) {
  return [
    {
      id: firstId,
      priority: LOOPBACK_PRIORITY,
      action: { type: "allow" },
      condition: { requestDomains: LOOPBACK_REQUEST_DOMAINS },
    },
    {
      id: firstId + 1,
      priority: LOOPBACK_PRIORITY,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: LOOPBACK_REQUEST_DOMAINS, resourceTypes: ["main_frame", "sub_frame"] },
    },
  ];
}
