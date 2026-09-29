import { describe, expect, it } from "vitest";
import { describeSelector } from "./ruleLabel";

describe("describeSelector", () => {
  it("names the thing by its id or class", () => {
    expect(describeSelector("#sponsor-box")).toEqual({ kind: "box", name: "sponsor box" });
    expect(describeSelector("div.feed > article.promotedPost")).toEqual({ kind: "box", name: "promoted post" });
    expect(describeSelector("aside .ad_slot img")).toEqual({ kind: "image", name: null });
  });

  it("reads the kind from the last element's tag", () => {
    expect(describeSelector("iframe[src*=ads]")).toEqual({ kind: "frame", name: null });
    expect(describeSelector("a.cta-banner")).toEqual({ kind: "link", name: "cta banner" });
    expect(describeSelector("video")).toEqual({ kind: "video", name: null });
  });

  it("skips generated names", () => {
    expect(describeSelector("div.css-1x9ab2")).toEqual({ kind: "box", name: null });
    expect(describeSelector("div._3fZq7.newsletter-popup")).toEqual({ kind: "box", name: "newsletter popup" });
    expect(describeSelector("div:nth-child(3)")).toEqual({ kind: "box", name: null });
  });

  it("ignores combinators inside attribute selectors", () => {
    expect(describeSelector('div[data-x="a > b"].promo-card')).toEqual({ kind: "box", name: "promo card" });
  });
});
