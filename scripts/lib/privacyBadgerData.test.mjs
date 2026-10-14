import { describe, expect, it } from "vitest";
import { entityLookup, parseConfig, parseEntityGroups, parseSeedActions, parseWidgetDomains, validatePrivacyBadgerData } from "./privacyBadgerData.mjs";

describe("parseConfig", () => {
  it("reads the yellowlist and merges both kinds of site fix, lowercase and sorted", () => {
    const config = {
      yellowlist: ["B.com", "a.com", "a.com"],
      sitefixes: { gpc: { "x.com": ["y.com"] }, yellowlist: { "t.com": ["Shop.com"] }, ignore: { "t.com": ["news.com"], "u.com": ["v.com"] } },
    };
    expect(parseConfig(config)).toEqual({ yellowlist: ["a.com", "b.com"], siteFixes: { "t.com": ["news.com", "shop.com"], "u.com": ["v.com"] } });
  });

  it("refuses a config without a yellowlist", () => {
    expect(() => parseConfig({})).toThrow(/yellowlist/);
  });
});

describe("parseWidgetDomains", () => {
  it("collects every embed domain, wildcard dropped", () => {
    const widgets = { Disqus: { domain: "disqus.com", domains: ["*.disqus.com"], replacementButton: { unblockDomains: ["disqus.com", "c.disquscdn.com"] } }, X: { domain: "platform.x.com" } };
    expect(parseWidgetDomains(widgets)).toEqual(["c.disquscdn.com", "disqus.com", "platform.x.com"]);
  });
});

describe("parseSeedActions", () => {
  it("splits the action map into block and cookieblock, sorted", () => {
    const seed = { action_map: { "b.com": { heuristicAction: "block" }, "a.com": { heuristicAction: "block" }, "c.com": { heuristicAction: "cookieblock" }, "d.com": { heuristicAction: "allow" }, "e.com": {} } };
    expect(parseSeedActions(seed)).toEqual({ block: ["a.com", "b.com"], cookieblock: ["c.com"] });
  });

  it("refuses a file without an action map", () => {
    expect(() => parseSeedActions({})).toThrow(/action_map/);
  });
});

describe("parseEntityGroups", () => {
  const source = `/** groups */
let multiDomainFirstPartiesArray = [
  ["1800contacts.com", "800contacts.com"],
  [
    "action.group",

    // a comment
    "FD.ru",
  ],
];

function makeDomainLookup(mdfpArray) { return mdfpArray; }`;

  it("reads the array as data: comments and trailing commas dropped, lowercase", () => {
    expect(parseEntityGroups(source)).toEqual([["1800contacts.com", "800contacts.com"], ["action.group", "fd.ru"]]);
  });

  it("refuses a file without the array", () => {
    expect(() => parseEntityGroups("let x = [];")).toThrow(/not found/);
  });
});

describe("validatePrivacyBadgerData", () => {
  const many = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i}.com`);
  const ok = {
    block: many(1500, "b"),
    cookieblock: many(400, "c"),
    entities: Array.from({ length: 200 }, (_, i) => [`e${i}.com`, `f${i}.com`]),
    yellowlist: many(500, "y"),
    widgetDomains: many(20, "w"),
    siteFixes: { "t.com": ["shop.com"] },
  };

  it("accepts a full data set", () => {
    expect(() => validatePrivacyBadgerData(ok)).not.toThrow();
  });

  it("refuses a suspiciously small one", () => {
    expect(() => validatePrivacyBadgerData({ ...ok, block: many(10, "b") })).toThrow(/suspiciously small/);
    expect(() => validatePrivacyBadgerData({ ...ok, cookieblock: [] })).toThrow(/cookie-blocked/);
    expect(() => validatePrivacyBadgerData({ ...ok, entities: [] })).toThrow(/site groups/);
    expect(() => validatePrivacyBadgerData({ ...ok, yellowlist: [] })).toThrow(/yellowlisted/);
    expect(() => validatePrivacyBadgerData({ ...ok, widgetDomains: [] })).toThrow(/widget/);
  });

  it("refuses entries that aren't hostnames", () => {
    expect(() => validatePrivacyBadgerData({ ...ok, block: [...ok.block, "http://x.com/"] })).toThrow(/plain hostnames/);
  });
});

describe("entityLookup", () => {
  it("maps every site in a group to the whole group", () => {
    const lookup = entityLookup([["google.com", "youtube.com"]]);
    expect(lookup.get("youtube.com")).toEqual(["google.com", "youtube.com"]);
    expect(lookup.get("example.com")).toBeUndefined();
  });
});
