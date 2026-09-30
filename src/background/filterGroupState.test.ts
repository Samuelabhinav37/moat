import { describe, expect, it } from "vitest";
import { effectiveFilterGroupState, enabledRuleCount, fillByImportance, orderGroupsByImportance, type FilterListInfo } from "./filterGroupState";

describe("effectiveFilterGroupState", () => {
  it("defaults every group to on when there are no overrides and the master switch is on", () => {
    expect(effectiveFilterGroupState(true, {}, ["ads", "trackers"])).toEqual({ ads: true, trackers: true });
  });

  it("respects an explicit off override for one group", () => {
    expect(effectiveFilterGroupState(true, { ads: false }, ["ads", "trackers"])).toEqual({
      ads: false,
      trackers: true,
    });
  });

  it("turns every group off when the master switch is off, regardless of overrides", () => {
    expect(effectiveFilterGroupState(false, { ads: true, trackers: true }, ["ads", "trackers"])).toEqual({
      ads: false,
      trackers: false,
    });
  });

  it("only includes groups actually passed in, ignoring stray override keys", () => {
    expect(effectiveFilterGroupState(true, { unknown: false }, ["ads"])).toEqual({ ads: true });
  });
});

describe("orderGroupsByImportance and fillByImportance", () => {
  const list = (group: string, category: string, ruleCount: number): FilterListInfo => ({ group, category, ruleCount });

  // Moat's real groups with their packed rule counts (0.11.182), the ones
  // the Firefox bug was measured with.
  const REAL: FilterListInfo[] = [
    list("social-widgets", "annoyance", 601),
    list("phishing-urls", "security", 27238),
    list("malicious-urls", "security", 8940),
    list("trackers", "ads", 10999),
    list("ads", "ads", 15308),
    list("url-tracking", "ads", 2467),
    list("popups", "ads", 1779),
    list("scam", "security", 13),
    list("badware", "security", 1272),
    list("oisd", "ads", 2),
    list("privacy-headers", "core", 2),
    list("cookie-notices", "annoyance", 2613),
    list("annoyances", "annoyance", 537),
  ];

  it("puts ads first and annoyance lists last, whatever the input order", () => {
    const order = orderGroupsByImportance(REAL);
    expect(order.slice(0, 3)).toEqual(["privacy-headers", "ads", "scam"]);
    expect(order.slice(-3)).toEqual(["cookie-notices", "annoyances", "social-widgets"]);
  });

  it("places an unknown group by its category, security before ads before annoyance", () => {
    const order = orderGroupsByImportance([list("new-annoyance", "annoyance", 1), list("new-security", "security", 1), list("new-ads", "ads", 1)]);
    expect(order).toEqual(["new-security", "new-ads", "new-annoyance"]);
  });

  it("does not mutate the input", () => {
    const copy = [...REAL];
    orderGroupsByImportance(REAL);
    expect(REAL).toEqual(copy);
  });

  it("keeps everything when it all fits", () => {
    expect(fillByImportance(REAL, 330_000).dropped).toEqual([]);
  });

  it("on Firefox's 30,000 rules keeps ads and trackers and skips only what doesn't fit", () => {
    // The Balanced preset (no annoyance lists).
    const balanced = REAL.filter((l) => l.category !== "annoyance");
    const { kept, dropped } = fillByImportance(balanced, 30_000);
    expect(kept).toEqual(expect.arrayContaining(["ads", "trackers", "popups", "scam", "badware", "oisd", "privacy-headers"]));
    expect(dropped).toEqual(["url-tracking", "malicious-urls", "phishing-urls"]);
    const used = balanced.filter((l) => kept.includes(l.group)).reduce((sum, l) => sum + l.ruleCount, 0);
    expect(used).toBeLessThanOrEqual(30_000);
  });

  it("lets a small list in after a big one didn't fit", () => {
    const { kept, dropped } = fillByImportance([list("ads", "ads", 90), list("trackers", "ads", 50), list("popups", "ads", 5)], 100);
    expect(kept).toEqual(["ads", "popups"]);
    expect(dropped).toEqual(["trackers"]);
  });
});

describe("enabledRuleCount", () => {
  const entries = [
    { group: "ads", ruleCount: 100 },
    { group: "ads", ruleCount: 50 },
    { group: "trackers", ruleCount: 70 },
    { group: "oisd", ruleCount: 30 },
  ];

  it("sums only the rulesets whose group is on", () => {
    expect(enabledRuleCount(entries, { ads: true, trackers: false, oisd: false })).toBe(150);
  });

  it("counts a group the choices don't mention, since it's treated as on", () => {
    // The 0.11.130 bug: oisd wasn't in any preset, so it was on and uncounted.
    expect(enabledRuleCount(entries, { ads: true, trackers: false })).toBe(180);
  });
});
