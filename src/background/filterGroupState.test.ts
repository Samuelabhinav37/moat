import { describe, expect, it } from "vitest";
import { effectiveFilterGroupState } from "./filterGroupState";

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
