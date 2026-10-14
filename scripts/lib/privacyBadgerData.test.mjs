import { describe, expect, it } from "vitest";
import { entityLookup, parseEntityGroups, parseSeedActions, validatePrivacyBadgerData } from "./privacyBadgerData.mjs";

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
  const ok = { block: many(1500, "b"), cookieblock: many(400, "c"), entities: Array.from({ length: 200 }, (_, i) => [`e${i}.com`, `f${i}.com`]) };

  it("accepts a full data set", () => {
    expect(() => validatePrivacyBadgerData(ok)).not.toThrow();
  });

  it("refuses a suspiciously small one", () => {
    expect(() => validatePrivacyBadgerData({ ...ok, block: many(10, "b") })).toThrow(/suspiciously small/);
    expect(() => validatePrivacyBadgerData({ ...ok, cookieblock: [] })).toThrow(/cookie-blocked/);
    expect(() => validatePrivacyBadgerData({ ...ok, entities: [] })).toThrow(/site groups/);
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
