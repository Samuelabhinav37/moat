// @vitest-environment jsdom
// Split out from cosmeticSelectors.test.ts, whose other cases are pure
// string/object logic and run under the project's default "node"
// environment -- this is the one function here that needs a real DOM to
// call querySelectorAll against.
import { describe, expect, it } from "vitest";
import { matchingCustomRuleOrigins } from "./cosmeticSelectors";

describe("matchingCustomRuleOrigins", () => {
  it("returns only the origins whose selector matches something in the document", () => {
    document.body.innerHTML = '<div id="ad"></div>';
    const result = matchingCustomRuleOrigins(document, [
      { hostname: "example.com", selector: "#ad" },
      { hostname: "example.com", selector: "#not-there" },
    ]);
    expect(result).toEqual([{ hostname: "example.com", selector: "#ad" }]);
  });

  it("returns an empty array when nothing matches", () => {
    document.body.innerHTML = "<div></div>";
    expect(matchingCustomRuleOrigins(document, [{ hostname: "example.com", selector: "#missing" }])).toEqual([]);
  });

  it("treats a malformed selector as not matching, without throwing", () => {
    document.body.innerHTML = "<div></div>";
    expect(() =>
      matchingCustomRuleOrigins(document, [{ hostname: "example.com", selector: ":::not-a-selector" }])
    ).not.toThrow();
    expect(matchingCustomRuleOrigins(document, [{ hostname: "example.com", selector: ":::not-a-selector" }])).toEqual(
      []
    );
  });

  it("returns an empty array for an empty origins list", () => {
    expect(matchingCustomRuleOrigins(document, [])).toEqual([]);
  });
});
