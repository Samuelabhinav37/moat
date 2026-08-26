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
});
