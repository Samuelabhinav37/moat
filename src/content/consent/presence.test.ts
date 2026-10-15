// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { platformPresent } from "./presence";

const presence = { selectors: ["#onetrust-banner-sdk", "div[unclosed"], texts: [["title", ["TrustArc Preference Manager"]]] as [string, string[]][] };

describe("platformPresent", () => {
  it("finds a platform's banner target", () => {
    document.body.innerHTML = '<div id="onetrust-banner-sdk"></div>';
    expect(platformPresent(presence)).toBe(true);
  });

  it("needs the text where a target asks for it", () => {
    document.body.innerHTML = "";
    document.title = "My shop";
    expect(platformPresent(presence)).toBe(false);
    document.title = "TrustArc Preference Manager";
    expect(platformPresent(presence)).toBe(true);
  });

  it("skips a selector the browser can't parse instead of failing", () => {
    document.title = "";
    document.body.innerHTML = "<p>No banner here</p>";
    expect(platformPresent(presence)).toBe(false);
  });
});
