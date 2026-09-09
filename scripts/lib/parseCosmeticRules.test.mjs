import { describe, expect, it } from "vitest";
import { buildCosmeticIndex, isSafeCssDeclarationText, parseCosmeticLine } from "./parseCosmeticRules.mjs";

const alwaysValid = () => true;

describe("parseCosmeticLine", () => {
  it("parses a generic hide rule", () => {
    expect(parseCosmeticLine("##.ad-banner")).toEqual({
      isException: false,
      domains: [],
      selector: ".ad-banner",
    });
  });

  it("parses a domain-scoped hide rule with multiple domains", () => {
    expect(parseCosmeticLine("example.com,other.com##.ad")).toEqual({
      isException: false,
      domains: ["example.com", "other.com"],
      selector: ".ad",
    });
  });

  it("parses a negative-domain rule", () => {
    expect(parseCosmeticLine("~example.com##.ad")).toEqual({
      isException: false,
      domains: ["~example.com"],
      selector: ".ad",
    });
  });

  it("parses an exception rule", () => {
    expect(parseCosmeticLine("example.com#@#.ad")).toEqual({
      isException: true,
      domains: ["example.com"],
      selector: ".ad",
    });
  });

  it("ignores comments and metadata lines", () => {
    expect(parseCosmeticLine("! this is a comment")).toBeNull();
    expect(parseCosmeticLine("[Adblock Plus 2.0]")).toBeNull();
    expect(parseCosmeticLine("")).toBeNull();
  });

  it("ignores plain network rules with no cosmetic marker", () => {
    expect(parseCosmeticLine("||ads.example.com^")).toBeNull();
  });

  it("keeps native :has() selectors", () => {
    expect(parseCosmeticLine("##div:has(.ad)")).toEqual({
      isException: false,
      domains: [],
      selector: "div:has(.ad)",
    });
  });

  it("parses a CSS-injection rule (#$#)", () => {
    expect(parseCosmeticLine("example.com#$#.ad { display: none !important; }")).toEqual({
      isException: false,
      domains: ["example.com"],
      selector: ".ad",
      declaration: "display: none !important;",
    });
  });

  it("parses a bare CSS-injection exception (#@$#), same shape as #@#", () => {
    expect(parseCosmeticLine("example.com#@$#.ad")).toEqual({
      isException: true,
      domains: ["example.com"],
      selector: ".ad",
    });
  });

  it("fans a multi-domain CSS-injection rule out to every listed domain", () => {
    expect(parseCosmeticLine("a.com,b.com#$#.ad { overflow: auto !important; }")).toEqual({
      isException: false,
      domains: ["a.com", "b.com"],
      selector: ".ad",
      declaration: "overflow: auto !important;",
    });
  });

  it("rejects a CSS-injection rule with no selector before the brace", () => {
    expect(parseCosmeticLine("example.com#$#{ display: none; }")).toBeNull();
  });

  it("rejects a CSS-injection rule that isn't `selector { declaration }` shaped", () => {
    expect(parseCosmeticLine("example.com#$#.ad display: none;")).toBeNull();
  });

  it("rejects a CSS-injection declaration containing a forbidden token", () => {
    expect(parseCosmeticLine('example.com#$#.ad { content: "</style>"; }')).toBeNull();
    expect(parseCosmeticLine("example.com#$#.ad { content: `x`; }")).toBeNull();
  });

  it("isSafeCssDeclarationText rejects known escape/execution vectors", () => {
    expect(isSafeCssDeclarationText("display: none !important;")).toBe(true);
    expect(isSafeCssDeclarationText("")).toBe(false);
    expect(isSafeCssDeclarationText("a".repeat(2001))).toBe(false);
    expect(isSafeCssDeclarationText("width: expression(alert(1));")).toBe(false);
    expect(isSafeCssDeclarationText("</style><script>alert(1)</script>")).toBe(false);
  });

  it("rejects a CSS-injection selector using extended-selector syntax", () => {
    expect(parseCosmeticLine("example.com#$#div:contains(x) { display: none; }")).toBeNull();
  });

  it("rejects scriptlet rules (#%#)", () => {
    expect(parseCosmeticLine("example.com#%#//scriptlet('abort-on-property-read')")).toBeNull();
  });

  it("still rejects the extended pseudos with no runtime support", () => {
    expect(parseCosmeticLine("##.ad+js(abort-on-property-read)")).toBeNull();
    expect(parseCosmeticLine("##div:matches-attr(data-ad)")).toBeNull();
    expect(parseCosmeticLine("##div:matches-path(/shop/)")).toBeNull();
    expect(parseCosmeticLine("##div:style(display: none)")).toBeNull();
    expect(parseCosmeticLine("##^script:has-text(adblock)")).toBeNull(); // HTML filtering
  });

  it("parses procedural pseudos (:has-text, :matches-css, :xpath, :upward, :remove)", () => {
    expect(parseCosmeticLine("##div:contains(Advertisement)")).toMatchObject({
      isException: false,
      procedural: { s: "div", t: [["has-text", "Advertisement"]] },
    });
    expect(parseCosmeticLine("example.com##.box:has-text(Sponsored):upward(2)")).toMatchObject({
      domains: ["example.com"],
      procedural: { s: ".box", t: [["has-text", "Sponsored"], ["upward", 2]] },
    });
    expect(parseCosmeticLine("##:xpath(//div[@id='ad'])")).toMatchObject({
      procedural: { s: "", t: [["xpath", "//div[@id='ad']"]] },
    });
    expect(parseCosmeticLine("##div:xpath(./span)")).toMatchObject({
      procedural: { s: "div", t: [["xpath", "./span"]] },
    });
    expect(parseCosmeticLine("a.com#?#.promo:remove()")).toMatchObject({
      procedural: { s: ".promo", t: [], r: 1 },
    });
    // #@?# and #@# on a procedural selector are string-matched exceptions.
    expect(parseCosmeticLine("a.com#@?#.promo:has-text(x)")).toMatchObject({
      isException: true,
      selector: ".promo:has-text(x)",
    });
  });

  it("returns null for a marker with no selector after it", () => {
    expect(parseCosmeticLine("example.com##")).toBeNull();
  });
});

describe("buildCosmeticIndex", () => {
  it("puts a plain ##rule into generic", () => {
    const index = buildCosmeticIndex(["##.ad-banner"], alwaysValid);
    expect(index.generic).toEqual([".ad-banner"]);
    expect(index.perDomain).toEqual({});
  });

  it("puts a domain-scoped rule into perDomain, not generic", () => {
    const index = buildCosmeticIndex(["example.com##.ad"], alwaysValid);
    expect(index.generic).toEqual([]);
    expect(index.perDomain).toEqual({ "example.com": [".ad"] });
  });

  it("fans a multi-domain rule out to every listed domain", () => {
    const index = buildCosmeticIndex(["a.com,b.com##.ad"], alwaysValid);
    expect(index.perDomain).toEqual({ "a.com": [".ad"], "b.com": [".ad"] });
  });

  it("treats a pure-negative rule as generic plus an exception", () => {
    const index = buildCosmeticIndex(["~example.com##.ad"], alwaysValid);
    expect(index.generic).toEqual([".ad"]);
    expect(index.exceptions).toEqual({ "example.com": [".ad"] });
  });

  it("splits a mixed positive/negative rule into perDomain and exceptions", () => {
    const index = buildCosmeticIndex(["a.com,~b.com##.ad"], alwaysValid);
    expect(index.perDomain).toEqual({ "a.com": [".ad"] });
    expect(index.exceptions).toEqual({ "b.com": [".ad"] });
  });

  it("puts an explicit #@# exception into exceptions", () => {
    const index = buildCosmeticIndex(["example.com#@#.ad"], alwaysValid);
    expect(index.exceptions).toEqual({ "example.com": [".ad"] });
    expect(index.generic).toEqual([]);
    expect(index.perDomain).toEqual({});
  });

  it("drops selectors that fail validation", () => {
    const index = buildCosmeticIndex(["##.ad", "##div:has(:invalid-thing("], () => false);
    expect(index.generic).toEqual([]);
  });

  it("de-duplicates identical selectors across multiple filter files", () => {
    const index = buildCosmeticIndex(["##.ad", "##.ad"], alwaysValid);
    expect(index.generic).toEqual([".ad"]);
  });

  it("merges rules across multiple filter texts for the same domain", () => {
    const index = buildCosmeticIndex(["example.com##.ad-a", "example.com##.ad-b"], alwaysValid);
    expect(index.perDomain["example.com"]).toEqual([".ad-a", ".ad-b"]);
  });

  it("puts a generic CSS-injection rule into cssInjection.generic", () => {
    const index = buildCosmeticIndex(["#$#.modal { display: none !important; }"], alwaysValid, alwaysValid);
    expect(index.cssInjection.generic).toEqual([[".modal", "display: none !important;"]]);
    expect(index.cssInjection.perDomain).toEqual({});
    expect(index.generic).toEqual([]);
  });

  it("puts a domain-scoped CSS-injection rule into cssInjection.perDomain", () => {
    const index = buildCosmeticIndex(["example.com#$#.modal { display: none !important; }"], alwaysValid, alwaysValid);
    expect(index.cssInjection.perDomain).toEqual({ "example.com": [[".modal", "display: none !important;"]] });
    expect(index.cssInjection.generic).toEqual([]);
  });

  it("routes a bare CSS-injection exception (#@$#) into the same exceptions map as #@#", () => {
    const index = buildCosmeticIndex(["example.com#@$#.modal"], alwaysValid, alwaysValid);
    expect(index.exceptions).toEqual({ "example.com": [".modal"] });
    expect(index.cssInjection.generic).toEqual([]);
    expect(index.cssInjection.perDomain).toEqual({});
  });

  it("drops a CSS-injection rule whose declaration fails validation", () => {
    const index = buildCosmeticIndex(["#$#.modal { display: none; }"], alwaysValid, () => false);
    expect(index.cssInjection.generic).toEqual([]);
  });

  it("does not require isValidDeclaration when no injection-syntax rules are present", () => {
    const index = buildCosmeticIndex(["##.ad"], alwaysValid);
    expect(index.generic).toEqual([".ad"]);
  });

  it("routes a procedural rule into procedural.perDomain / .generic", () => {
    const index = buildCosmeticIndex(
      ["example.com##.card:has-text(Sponsored)", "##.g:min-text-length(30):remove()"],
      alwaysValid
    );
    expect(index.procedural.perDomain["example.com"]).toEqual([
      { s: ".card", t: [["has-text", "Sponsored"]] },
    ]);
    expect(index.procedural.generic).toEqual([{ s: ".g", t: [["min-text-length", 30]], r: 1 }]);
    expect(index.generic).toEqual([]);
  });

  it("keeps `x` on a procedural rule only when an exception names it", () => {
    const index = buildCosmeticIndex(
      ["##.a:has-text(x)", "##.b:has-text(y)", "shop.com#@#.b:has-text(y)"],
      alwaysValid
    );
    const rules = index.procedural.generic;
    expect(rules.find((r) => r.s === ".a")).toEqual({ s: ".a", t: [["has-text", "x"]] });
    expect(rules.find((r) => r.s === ".b")).toEqual({ s: ".b", t: [["has-text", "y"]], x: ".b:has-text(y)" });
  });

  it("validates a procedural rule's CSS prefix with isValidSelector", () => {
    const index = buildCosmeticIndex(["##.bad:::(:has-text(x)"], () => false);
    expect(index.procedural.generic).toEqual([]);
  });
});
