import { describe, expect, it } from "vitest";
import { blockedPageQuery, destinationIn, hostOnList, kindForList, listForRule, pageMatch, parseBlockedPageQuery } from "./blockedPage";
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

describe("destinationIn", () => {
  it("finds the address in common click-link parameters", () => {
    expect(destinationIn("https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=https%3A%2F%2Fwww.example.com%2Fshoes")).toBe("https://www.example.com/shoes");
    expect(destinationIn("https://click.linksynergy.com/deeplink?id=x&mid=1&murl=https%3A%2F%2Fshop.example%2Fitem")).toBe("https://shop.example/item");
    expect(destinationIn("https://go.skimresources.com/?id=1X2&url=https%3A%2F%2Fwww.example.com%2Fdeal")).toBe("https://www.example.com/deal");
  });

  it("finds a doubly encoded address and one under an unusual key", () => {
    expect(destinationIn("https://click.lenovo.com/?q=https%253A%252F%252Fwww.lenovo.com%252Fus")).toBe("https://www.lenovo.com/us");
    expect(destinationIn("https://t.example.net/c?qs=abc&xyz=https%3A%2F%2Fwise.com%2Fsend")).toBe("https://wise.com/send");
  });

  it("finds an awstrack.me address in the path", () => {
    expect(destinationIn("https://abc.r.us-east-1.awstrack.me/L0/https:%2F%2Fwise.com%2Fsend%3Fx=1/1/0100abc/xyz=")).toBe("https://wise.com/send?x=1");
  });

  it("refuses anything that isn't a plain web address on another host", () => {
    expect(destinationIn("https://click.example.com/?url=javascript%3Aalert(1)")).toBeNull();
    expect(destinationIn("https://click.example.com/?url=data%3Atext%2Fhtml%2Chi")).toBeNull();
    expect(destinationIn("https://click.example.com/?url=https%3A%2F%2Fclick.example.com%2Floop")).toBeNull();
    expect(destinationIn("https://click.example.com/?url=https%3A%2F%2Fbank.example%40evil.example%2F")).toBeNull();
    expect(destinationIn("https://click.example.com/?id=12345")).toBeNull();
    expect(destinationIn("https://t.co/AbCdEf123")).toBeNull();
    // An address without "https://" isn't guessed at.
    expect(destinationIn("https://www.shareasale.com/r.cfm?b=1&u=2&m=3&urllink=www.example.com%2Fp")).toBeNull();
    expect(destinationIn("not a url")).toBeNull();
  });
});
