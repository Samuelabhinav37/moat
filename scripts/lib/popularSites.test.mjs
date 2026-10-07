import { describe, expect, it } from "vitest";
import { dropPopularSiteRules, dropPopularSites, isWholePopularSite, parsePopularSites } from "./popularSites.mjs";

const FIXTURE_PSL = {
  rules: new Set(["com", "co.uk", "uk", "net", "github.io", "io"]),
  exceptions: new Set(),
};
const popular = parsePopularSites(
  "1,google.com\r\n2,surveymonkey.com\n3,login.microsoftonline.com\n4,bbc.co.uk\n5,weebly.com\n",
  FIXTURE_PSL
);

describe("parsePopularSites", () => {
  it("keeps each ranked domain and adds the registrable domain of a ranked subdomain", () => {
    expect(popular.has("login.microsoftonline.com")).toBe(true);
    expect(popular.has("microsoftonline.com")).toBe(true);
    expect(popular.has("bbc.co.uk")).toBe(true);
    expect(popular.has("co.uk")).toBe(false);
  });
});

describe("isWholePopularSite", () => {
  it("matches the site and its www.", () => {
    expect(isWholePopularSite("surveymonkey.com", popular)).toBe(true);
    expect(isWholePopularSite("WWW.SurveyMonkey.com", popular)).toBe(true);
  });

  it("keeps subdomains of a popular host blockable, where phishing pages live", () => {
    expect(isWholePopularSite("secure-login-123.weebly.com", popular)).toBe(false);
    expect(isWholePopularSite("evil.surveymonkey.com", popular)).toBe(false);
  });

  it("does not match an unrelated look-alike", () => {
    expect(isWholePopularSite("surveymonkey.com.evil.io", popular)).toBe(false);
    expect(isWholePopularSite("google.co", popular)).toBe(false);
  });
});

describe("dropPopularSites", () => {
  it("splits a domain list", () => {
    expect(dropPopularSites(["fake-shop.io", "www.google.com", "x.weebly.com"], popular)).toEqual({
      kept: ["fake-shop.io", "x.weebly.com"],
      dropped: ["www.google.com"],
    });
  });
});

describe("dropPopularSiteRules", () => {
  const block = (id, condition) => ({ id, priority: 1, action: { type: "block" }, condition });

  it("drops a whole-site block rule and keeps path, regex and subdomain rules", () => {
    const rules = [
      block(1, { urlFilter: "||surveymonkey.com^" }),
      block(2, { urlFilter: "||surveymonkey.com/r/phish" }),
      block(3, { urlFilter: "||google.com^", regexFilter: "^https://google\\.com/evil" }),
      block(4, { urlFilter: "||x.weebly.com^" }),
    ];
    const { kept, dropped } = dropPopularSiteRules(rules, popular);
    expect(kept.map((r) => r.id)).toEqual([2, 3, 4]);
    expect(dropped).toEqual(["surveymonkey.com"]);
  });

  it("takes popular sites out of requestDomains and drops a rule left empty", () => {
    const rules = [
      block(1, { requestDomains: ["fake-shop.io", "google.com"] }),
      block(2, { requestDomains: ["bbc.co.uk"] }),
    ];
    const { kept, dropped } = dropPopularSiteRules(rules, popular);
    expect(kept).toEqual([block(1, { requestDomains: ["fake-shop.io"] })]);
    expect(dropped).toEqual(["google.com", "bbc.co.uk"]);
  });

  it("never touches allow rules", () => {
    const allow = { id: 9, priority: 2, action: { type: "allow" }, condition: { urlFilter: "||google.com^" } };
    expect(dropPopularSiteRules([allow], popular)).toEqual({ kept: [allow], dropped: [] });
  });
});
