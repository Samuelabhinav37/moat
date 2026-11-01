import { describe, expect, it } from "vitest";
import { buildAdPageRules, isAdPageSource } from "./adPageRules.mjs";

const block = (condition) => ({ id: 1, priority: 1, action: { type: "block" }, condition });

describe("buildAdPageRules", () => {
  it("turns plainly blocked domains into page blocks, once each", () => {
    const rules = buildAdPageRules([[block({ urlFilter: "||ads.example^" })], [block({ urlFilter: "||ads.example^" }), block({ requestDomains: ["track.example"] })]]);
    expect(rules).toEqual([{ id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["ads.example", "track.example"], resourceTypes: ["main_frame"] } }]);
  });

  it("skips narrower rules and shared link hosts", () => {
    const rules = buildAdPageRules([
      [
        block({ urlFilter: "||cdn.example^", resourceTypes: ["script"] }),
        block({ urlFilter: "||ads.example^", domainType: "thirdParty" }),
        block({ urlFilter: "||site.example/ads/" }),
        block({ urlFilter: "||click.pstmrk.it^" }),
        { id: 2, priority: 1, action: { type: "allow" }, condition: { urlFilter: "||ok.example^" } },
      ],
    ]);
    expect(rules).toEqual([]);
  });
});

describe("isAdPageSource", () => {
  it("takes the ad and tracker lists but not Peter Lowe or Privacy Badger", () => {
    expect(isAdPageSource({ id: "ruleset_ads-1", group: "ads" })).toBe(true);
    expect(isAdPageSource({ id: "ruleset_trackers-extra", group: "trackers" })).toBe(true);
    expect(isAdPageSource({ id: "ruleset_peter-lowe", group: "trackers" })).toBe(false);
    expect(isAdPageSource({ id: "ruleset_pb-trackers", group: "trackers" })).toBe(false);
    expect(isAdPageSource({ id: "ruleset_oisd-1", group: "oisd" })).toBe(false);
  });
});
