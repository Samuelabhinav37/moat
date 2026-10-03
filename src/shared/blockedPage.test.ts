import { describe, expect, it } from "vitest";
import { blockedPageQuery, hostOnList, kindForList, listForRule, pageMatch, parseBlockedPageQuery } from "./blockedPage";
import type { RulesetManifestEntry } from "./rulesetManifest";

const entry = (id: string, group: string, category: RulesetManifestEntry["category"]): RulesetManifestEntry => ({ id, group, category, name: id, enabled: true, file: `${id}.json`, ruleCount: 1 });
const MANIFEST = [entry("ads-1", "ads", "ads"), entry("phishing-urls", "phishing-urls", "security"), entry("scam", "scam", "security")];

describe("listForRule", () => {
  it("names a bundled list by its ruleset's group", () => {
    expect(listForRule({ rulesetId: "ads-1", ruleId: 4 }, MANIFEST, () => null)).toBe("ads");
    expect(listForRule({ rulesetId: "gone", ruleId: 4 }, MANIFEST, () => null)).toBe("unknown");
  });

  it("names dynamic rules by their id range", () => {
    expect(listForRule({ rulesetId: "_dynamic", ruleId: 800_003 }, MANIFEST, () => null)).toBe("custom");
    expect(listForRule({ rulesetId: "_dynamic", ruleId: 820_001 }, MANIFEST, () => null)).toBe("policy");
    expect(listForRule({ rulesetId: "_dynamic", ruleId: 960_000 }, MANIFEST, () => null)).toBe("policy");
    expect(listForRule({ rulesetId: "_dynamic", ruleId: 930_000 }, MANIFEST, () => "scam")).toBe("scam");
    expect(listForRule({ rulesetId: "_dynamic", ruleId: 930_000 }, MANIFEST, () => null)).toBe("unknown");
    expect(listForRule({ rulesetId: "_dynamic", ruleId: 5 }, MANIFEST, () => null)).toBe("unknown");
  });
});

describe("kindForList", () => {
  it("is danger for security lists and ads for the rest", () => {
    expect(kindForList("phishing-urls", MANIFEST)).toBe("danger");
    expect(kindForList("ads", MANIFEST)).toBe("ads");
    expect(kindForList("unknown", MANIFEST)).toBe("ads");
    expect(kindForList("custom", MANIFEST)).toBe("custom");
    expect(kindForList("policy", MANIFEST)).toBe("policy");
  });
});

describe("pageMatch", () => {
  it("picks the match closest to the refused load", () => {
    const old = { rulesetId: "ads-1", ruleId: 1, timeStamp: 1_000 };
    const page = { rulesetId: "scam", ruleId: 2, timeStamp: 4_990 };
    expect(pageMatch([old, page], 5_000)).toBe(page);
    expect(pageMatch([], 5_000)).toBeNull();
  });
});

describe("hostOnList", () => {
  it("matches the site or a parent domain", () => {
    const list = new Set(["bad.example"]);
    expect(hostOnList("bad.example", list)).toBe(true);
    expect(hostOnList("login.bad.example", list)).toBe(true);
    expect(hostOnList("notbad.example", list)).toBe(false);
  });
});

describe("blocked.html query", () => {
  it("round-trips", () => {
    const params = { url: "https://bad.example/login?x=1", list: "phishing-urls", kind: "danger" as const };
    expect(parseBlockedPageQuery(`?${blockedPageQuery(params)}`)).toEqual(params);
  });

  it("refuses odd input", () => {
    expect(parseBlockedPageQuery("?u=javascript:alert(1)&list=ads&kind=ads")).toBeNull();
    expect(parseBlockedPageQuery("?u=https://a.example/&list=ads&kind=nope")).toBeNull();
    expect(parseBlockedPageQuery("?u=https://a.example/&list=<b>&kind=ads")).toBeNull();
    expect(parseBlockedPageQuery("?list=ads&kind=ads")).toBeNull();
  });
});
