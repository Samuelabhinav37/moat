import { describe, expect, it } from "vitest";
import { effectiveFilterGroupState, orderGroupsByDropPriority, type FilterListInfo } from "./filterGroupState";

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

describe("orderGroupsByDropPriority", () => {
  const list = (group: string, category: string, ruleCount: number): FilterListInfo => ({
    group,
    category,
    ruleCount,
  });

  it("orders annoyance before ads before security, regardless of input order", () => {
    const input = [list("malicious-urls", "security", 9415), list("annoyances", "annoyance", 545), list("ads", "ads", 72806)];
    expect(orderGroupsByDropPriority(input)).toEqual(["annoyances", "ads", "malicious-urls"]);
  });

  it("within the same category, orders the biggest rule count first", () => {
    const input = [list("cookie-notices", "annoyance", 2762), list("social-widgets", "annoyance", 628), list("annoyances", "annoyance", 545)];
    expect(orderGroupsByDropPriority(input)).toEqual(["cookie-notices", "social-widgets", "annoyances"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(orderGroupsByDropPriority([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [list("ads", "ads", 1), list("annoyances", "annoyance", 2)];
    const copy = [...input];
    orderGroupsByDropPriority(input);
    expect(input).toEqual(copy);
  });

  // Moat's real 11 toggleable groups and their actual bundled rule counts
  // (as of the ClearURLs/AdGuard sync this session) -- a full-scale,
  // real-shape stress test rather than a 2-3-item toy example, specifically
  // because a toy example is exactly what let the front/back drop-direction
  // bug through review the first time.
  const REAL_GROUPS: FilterListInfo[] = [
    list("ads", "ads", 72806),
    list("trackers", "ads", 115554),
    list("url-tracking", "ads", 2467),
    list("popups", "ads", 2164),
    list("malicious-urls", "security", 9415),
    list("phishing-urls", "security", 64584),
    list("scam", "security", 971),
    list("badware", "security", 4091),
    list("social-widgets", "annoyance", 628),
    list("cookie-notices", "annoyance", 2762),
    list("annoyances", "annoyance", 545),
  ];

  it("orders every real annoyance group before every real ads group before every real security group", () => {
    const order = orderGroupsByDropPriority(REAL_GROUPS);
    const rank = (group: string) => order.indexOf(group);
    const annoyance = ["social-widgets", "cookie-notices", "annoyances"];
    const ads = ["ads", "trackers", "url-tracking", "popups"];
    const security = ["malicious-urls", "phishing-urls", "scam", "badware"];
    const maxRank = (groups: string[]) => Math.max(...groups.map(rank));
    const minRank = (groups: string[]) => Math.min(...groups.map(rank));
    expect(maxRank(annoyance)).toBeLessThan(minRank(ads));
    expect(maxRank(ads)).toBeLessThan(minRank(security));
  });

  it("simulates a real retry loop under a tight budget and never drops a security group before every non-security group is gone", () => {
    const order = orderGroupsByDropPriority(REAL_GROUPS);
    const totalRuleCount = new Map(REAL_GROUPS.map((g) => [g.group, g.ruleCount]));

    // Mirrors filterGroups.ts's actual retry loop: drop from the front
    // (least essential first) until the remaining set's total rule count
    // fits under a simulated budget.
    const BUDGET = 80_000; // fits at most a couple of the smaller groups
    let drop = 0;
    let remaining = order;
    while (
      drop <= order.length &&
      remaining.reduce((sum, group) => sum + totalRuleCount.get(group)!, 0) > BUDGET
    ) {
      drop += 1;
      remaining = order.slice(drop);
    }
    const dropped = order.slice(0, drop);

    // Every dropped group must be annoyance or ads category -- security
    // groups only start getting dropped once nothing else is left.
    const securityGroups = new Set(["malicious-urls", "phishing-urls", "scam", "badware"]);
    const droppedSecurity = dropped.filter((g) => securityGroups.has(g));
    const remainingNonSecurity = remaining.filter((g) => !securityGroups.has(g));
    expect(droppedSecurity.length === 0 || remainingNonSecurity.length === 0).toBe(true);
  });
});
