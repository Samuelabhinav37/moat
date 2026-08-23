import { describe, expect, it } from "vitest";
import { buildStyleText, mergeDomainShards, selectorsForHostname, type CosmeticIndex } from "./cosmeticSelectors";

describe("mergeDomainShards", () => {
  it("combines domain entries from multiple shard files into one object", () => {
    const merged = mergeDomainShards([{ "a.com": [".x"] }, { "b.com": [".y"] }]);
    expect(merged).toEqual({ "a.com": [".x"], "b.com": [".y"] });
  });

  it("returns an empty object for no shards", () => {
    expect(mergeDomainShards([])).toEqual({});
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
