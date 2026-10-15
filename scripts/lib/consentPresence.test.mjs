import { describe, expect, it } from "vitest";
import { buildConsentPresence } from "./consentPresence.mjs";

describe("buildConsentPresence", () => {
  it("collects each platform's present-matcher targets, text-filtered ones apart, frame-only ones left out", () => {
    const rules = {
      $schema: "x",
      onetrust: { detectors: [{ presentMatcher: { type: "css", target: { selector: "#onetrust-banner-sdk" } } }] },
      cookiebot: { detectors: [{ presentMatcher: [{ type: "css", target: { selector: "#CybotCookiebotDialog" } }] }] },
      trustarc: { detectors: [{ presentMatcher: { type: "css", target: { selector: "title", textFilter: ["TrustArc Preference Manager"] } } }] },
      sourcepoint: { detectors: [{ presentMatcher: { type: "css", target: { selector: ".message", iframeFilter: true } } }] },
      broken: "nope",
    };
    expect(buildConsentPresence(rules)).toEqual({
      selectors: ["#CybotCookiebotDialog", "#onetrust-banner-sdk"],
      texts: [["title", ["TrustArc Preference Manager"]]],
    });
  });
});
