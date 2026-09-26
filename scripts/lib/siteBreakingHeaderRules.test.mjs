import { describe, expect, it } from "vitest";
import { dropSiteBreakingHeaderRules } from "./siteBreakingHeaderRules.mjs";

const policy = (value, id = 1) => ({
  id,
  priority: 101,
  action: { type: "modifyHeaders", responseHeaders: [{ operation: "append", header: "Permissions-Policy", value }] },
  condition: { regexFilter: ".*", resourceTypes: ["main_frame"] },
});

describe("dropSiteBreakingHeaderRules", () => {
  it("drops the Private State Token and FedCM rules AdGuard ships", () => {
    const { kept, changed } = dropSiteBreakingHeaderRules([
      policy("private-state-token-redemption=()", 1),
      policy("private-state-token-issuance=()", 2),
      policy("identity-credentials-get=()", 3),
    ]);
    expect(kept).toEqual([]);
    expect(changed).toBe(3);
  });

  it("keeps the ad-tech ones", () => {
    const rules = [policy("run-ad-auction=()", 1), policy("join-ad-interest-group=()", 2), policy("browsing-topics=()", 3)];
    expect(dropSiteBreakingHeaderRules(rules)).toEqual({ kept: rules, changed: 0 });
  });

  it("strips only the breaking entry from a rule that sets several", () => {
    const rule = {
      id: 9,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { operation: "append", header: "Permissions-Policy", value: "private-state-token-issuance=()" },
          { operation: "append", header: "Permissions-Policy", value: "browsing-topics=()" },
        ],
      },
      condition: {},
    };
    const { kept, changed } = dropSiteBreakingHeaderRules([rule]);
    expect(changed).toBe(1);
    expect(kept[0].action.responseHeaders).toEqual([{ operation: "append", header: "Permissions-Policy", value: "browsing-topics=()" }]);
  });

  it("leaves block rules and request-header edits alone", () => {
    const block = { id: 1, priority: 1, action: { type: "block" }, condition: { urlFilter: "||ads.example^" } };
    const gpc = { id: 2, priority: 1, action: { type: "modifyHeaders", requestHeaders: [{ header: "Sec-GPC", operation: "set", value: "1" }] }, condition: {} };
    expect(dropSiteBreakingHeaderRules([block, gpc]).kept).toEqual([block, gpc]);
  });
});
