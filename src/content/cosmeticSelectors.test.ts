// @vitest-environment jsdom -- selectorsStillMatching below needs a real DOM;
// none of this file's other (pure-array) tests behave differently under it.
import { describe, expect, it } from "vitest";
import {
  buildGrayscaleStyleText,
  buildInjectionStyleText,
  buildStyleText,
  customSelectorsForHostname,
  domainInjectionRulesForHostname,
  domainSelectorsForHostname,
  genericInjectionRulesForHostname,
  genericSelectorsForHostname,
  mergeDomainShards,
  selectorsForHostname,
  selectorsStillMatching,
  shardIndicesForHostname,
  splitDomainShards,
  type CosmeticIndex,
} from "./cosmeticSelectors";
import { bucketForDomain } from "../shared/domainBucket";

describe("mergeDomainShards", () => {
  it("combines domain entries from multiple shard files into one object", () => {
    const merged = mergeDomainShards([{ "a.com": { h: [".x"] } }, { "b.com": { h: [".y"] } }]);
    expect(merged).toEqual({ "a.com": { h: [".x"] }, "b.com": { h: [".y"] } });
  });

  it("returns an empty object for no shards", () => {
    expect(mergeDomainShards([])).toEqual({});
  });
});

describe("splitDomainShards", () => {
  it("splits hide selectors and injection rules into separate maps", () => {
    const { perDomain, injectPerDomain } = splitDomainShards({
      "a.com": { h: [".ad"], i: [[".modal", "display:none"]] },
      "b.com": { h: [".banner"] },
      "c.com": { i: [[".x", "display:none"]] },
    });
    expect(perDomain).toEqual({ "a.com": [".ad"], "b.com": [".banner"] });
    expect(injectPerDomain).toEqual({ "a.com": [[".modal", "display:none"]], "c.com": [[".x", "display:none"]] });
  });

  it("returns empty maps for no entries", () => {
    expect(splitDomainShards({})).toEqual({ perDomain: {}, injectPerDomain: {} });
  });
});

describe("selectorsForHostname", () => {
  it("always includes generic selectors", () => {
    const index: CosmeticIndex = { generic: [".ad"], perDomain: {}, exceptions: {} };
    expect(selectorsForHostname(index, "example.com")).toEqual([".ad"]);
  });

  it("includes selectors scoped to the exact hostname", () => {
    const index: CosmeticIndex = { generic: [], perDomain: { "example.com": [".ad"] }, exceptions: {} };
    expect(selectorsForHostname(index, "example.com")).toEqual([".ad"]);
  });

  it("includes selectors scoped to a parent domain when visiting a subdomain", () => {
    const index: CosmeticIndex = { generic: [], perDomain: { "example.com": [".ad"] }, exceptions: {} };
    expect(selectorsForHostname(index, "www.example.com")).toEqual([".ad"]);
  });

  it("does not include selectors scoped to an unrelated domain", () => {
    const index: CosmeticIndex = { generic: [], perDomain: { "other.com": [".ad"] }, exceptions: {} };
    expect(selectorsForHostname(index, "example.com")).toEqual([]);
  });

  it("does not leak a subdomain's rules to its parent domain", () => {
    const index: CosmeticIndex = { generic: [], perDomain: { "sub.example.com": [".ad"] }, exceptions: {} };
    expect(selectorsForHostname(index, "example.com")).toEqual([]);
  });

  it("removes a selector excluded on this domain even though it's generic", () => {
    const index: CosmeticIndex = { generic: [".ad", ".banner"], perDomain: {}, exceptions: { "example.com": [".ad"] } };
    expect(selectorsForHostname(index, "example.com")).toEqual([".banner"]);
  });

  it("does not exclude a selector on domains other than the excepted one", () => {
    const index: CosmeticIndex = { generic: [".ad"], perDomain: {}, exceptions: { "example.com": [".ad"] } };
    expect(selectorsForHostname(index, "other.com")).toEqual([".ad"]);
  });

  it("de-duplicates when the same selector is both generic and domain-scoped", () => {
    const index: CosmeticIndex = { generic: [".ad"], perDomain: { "example.com": [".ad"] }, exceptions: {} };
    expect(selectorsForHostname(index, "example.com")).toEqual([".ad"]);
  });
});

describe("genericSelectorsForHostname", () => {
  it("returns the generic slice, ignoring perDomain entirely", () => {
    const index: CosmeticIndex = { generic: [".ad"], perDomain: { "example.com": [".other"] }, exceptions: {} };
    expect(genericSelectorsForHostname(index, "example.com")).toEqual([".ad"]);
  });

  it("removes a generic selector excluded on this domain", () => {
    const index: CosmeticIndex = { generic: [".ad", ".banner"], perDomain: {}, exceptions: { "example.com": [".ad"] } };
    expect(genericSelectorsForHostname(index, "example.com")).toEqual([".banner"]);
  });
});

describe("domainSelectorsForHostname", () => {
  it("returns the per-domain slice, ignoring generic entirely", () => {
    const index: CosmeticIndex = { generic: [".ad"], perDomain: { "example.com": [".only-domain"] }, exceptions: {} };
    expect(domainSelectorsForHostname(index, "example.com")).toEqual([".only-domain"]);
  });

  it("matches a parent domain's selectors when visiting a subdomain", () => {
    const index: CosmeticIndex = { generic: [], perDomain: { "example.com": [".ad"] }, exceptions: {} };
    expect(domainSelectorsForHostname(index, "www.example.com")).toEqual([".ad"]);
  });

  it("removes a domain-scoped selector excluded on this domain", () => {
    const index: CosmeticIndex = {
      generic: [],
      perDomain: { "example.com": [".ad", ".banner"] },
      exceptions: { "example.com": [".ad"] },
    };
    expect(domainSelectorsForHostname(index, "example.com")).toEqual([".banner"]);
  });
});

describe("genericInjectionRulesForHostname", () => {
  it("returns generic injection rules, ignoring injectPerDomain entirely", () => {
    const index: CosmeticIndex = {
      generic: [],
      perDomain: {},
      exceptions: {},
      injectGeneric: [[".modal", "display:none!important"]],
      injectPerDomain: { "example.com": [[".other", "display:none"]] },
    };
    expect(genericInjectionRulesForHostname(index, "example.com")).toEqual([[".modal", "display:none!important"]]);
  });

  it("removes a generic injection rule excluded on this domain", () => {
    const index: CosmeticIndex = {
      generic: [],
      perDomain: {},
      exceptions: { "example.com": [".modal"] },
      injectGeneric: [[".modal", "display:none"]],
    };
    expect(genericInjectionRulesForHostname(index, "example.com")).toEqual([]);
  });

  it("returns an empty array when injectGeneric is absent", () => {
    const index: CosmeticIndex = { generic: [], perDomain: {}, exceptions: {} };
    expect(genericInjectionRulesForHostname(index, "example.com")).toEqual([]);
  });
});

describe("domainInjectionRulesForHostname", () => {
  it("returns the per-domain injection rules, ignoring injectGeneric entirely", () => {
    const index: CosmeticIndex = {
      generic: [],
      perDomain: {},
      exceptions: {},
      injectGeneric: [[".other", "display:none"]],
      injectPerDomain: { "example.com": [[".modal", "display:none!important"]] },
    };
    expect(domainInjectionRulesForHostname(index, "example.com")).toEqual([[".modal", "display:none!important"]]);
  });

  it("matches a parent domain's injection rules when visiting a subdomain", () => {
    const index: CosmeticIndex = {
      generic: [],
      perDomain: {},
      exceptions: {},
      injectPerDomain: { "example.com": [[".modal", "display:none"]] },
    };
    expect(domainInjectionRulesForHostname(index, "www.example.com")).toEqual([[".modal", "display:none"]]);
  });

  it("removes a domain-scoped injection rule excluded on this domain", () => {
    const index: CosmeticIndex = {
      generic: [],
      perDomain: {},
      exceptions: { "example.com": [".modal"] },
      injectPerDomain: { "example.com": [[".modal", "display:none"]] },
    };
    expect(domainInjectionRulesForHostname(index, "example.com")).toEqual([]);
  });

  it("returns an empty array when injectPerDomain is absent", () => {
    const index: CosmeticIndex = { generic: [], perDomain: {}, exceptions: {} };
    expect(domainInjectionRulesForHostname(index, "example.com")).toEqual([]);
  });
});

describe("buildInjectionStyleText", () => {
  it("returns an empty string for no rules", () => {
    expect(buildInjectionStyleText([])).toBe("");
  });

  it("emits one block per rule, each with its own declaration", () => {
    expect(
      buildInjectionStyleText([
        [".modal", "display:none!important"],
        ["body", "overflow:auto!important"],
      ])
    ).toBe(".modal{display:none!important}\nbody{overflow:auto!important}");
  });
});

describe("selectorsStillMatching", () => {
  it("keeps a selector that matches an element in the document", () => {
    document.body.innerHTML = '<div class="ad"></div>';
    expect(selectorsStillMatching(document, [".ad"])).toEqual([".ad"]);
  });

  it("drops a selector that matches nothing", () => {
    document.body.innerHTML = "<div></div>";
    expect(selectorsStillMatching(document, [".ad"])).toEqual([]);
  });

  it("keeps selectors that throw rather than risk un-hiding something real", () => {
    document.body.innerHTML = "<div></div>";
    expect(selectorsStillMatching(document, [":this-is-not-valid-css("])).toEqual([":this-is-not-valid-css("]);
  });

  it("preserves input order across a mix of matching and non-matching selectors", () => {
    document.body.innerHTML = '<div class="a"></div><div class="c"></div>';
    expect(selectorsStillMatching(document, [".a", ".b", ".c"])).toEqual([".a", ".c"]);
  });
});

describe("customSelectorsForHostname", () => {
  it("returns selectors picked for the exact hostname", () => {
    expect(customSelectorsForHostname({ "example.com": ["#ad-1"] }, "example.com")).toEqual(["#ad-1"]);
  });

  it("matches a subdomain against a parent domain's picked selectors", () => {
    expect(customSelectorsForHostname({ "example.com": ["#ad-1"] }, "www.example.com")).toEqual(["#ad-1"]);
  });

  it("does not leak a subdomain's picks to an unrelated hostname", () => {
    expect(customSelectorsForHostname({ "sub.example.com": ["#ad-1"] }, "example.com")).toEqual([]);
  });

  it("returns an empty array when nothing was picked for this hostname", () => {
    expect(customSelectorsForHostname({}, "example.com")).toEqual([]);
  });

  it("de-duplicates when the same selector appears at multiple levels of the domain chain", () => {
    const rules = { "example.com": ["#ad-1"], "www.example.com": ["#ad-1"] };
    expect(customSelectorsForHostname(rules, "www.example.com")).toEqual(["#ad-1"]);
  });
});

describe("buildStyleText", () => {
  it("returns an empty string for no selectors", () => {
    expect(buildStyleText([])).toBe("");
  });

  it("joins selectors into a single hide rule when under the batch size", () => {
    expect(buildStyleText([".a", ".b"])).toBe(".a,.b{display:none!important}");
  });

  it("splits into multiple rules once past the per-rule selector batch size", () => {
    const selectors = Array.from({ length: 2500 }, (_, i) => `.s${i}`);
    const text = buildStyleText(selectors);
    const rules = text.split("\n");
    expect(rules).toHaveLength(2);
    expect(rules[0]?.split(",")).toHaveLength(2000);
    expect(rules[1]?.split(",")).toHaveLength(500);
  });
});

describe("shardIndicesForHostname", () => {
  it("includes the bucket for the exact hostname and every parent domain", () => {
    const indices = shardIndicesForHostname("www.example.com", 64);
    expect(indices).toContain(bucketForDomain("www.example.com", 64));
    expect(indices).toContain(bucketForDomain("example.com", 64));
  });

  it("de-duplicates when two levels of the domain chain hash to the same bucket", () => {
    // Force a collision by using a bucket count of 1 -- every domain lands in bucket 0.
    expect(shardIndicesForHostname("a.b.c.example.com", 1)).toEqual([0]);
  });

  it("returns one index for a bare two-label hostname", () => {
    const indices = shardIndicesForHostname("example.com", 64);
    expect(indices).toEqual([bucketForDomain("example.com", 64)]);
  });
});

describe("buildGrayscaleStyleText", () => {
  it("returns an empty string for no selectors", () => {
    expect(buildGrayscaleStyleText([])).toBe("");
  });

  it("emits a grayscale filter rule instead of display:none", () => {
    expect(buildGrayscaleStyleText([".a", ".b"])).toBe(".a,.b{filter:grayscale(1)!important}");
  });
});
