import { describe, expect, it } from "vitest";
import { groupLabel, groupSites, siteOf } from "./siteGroups";

describe("siteOf", () => {
  it("keeps the last two labels", () => {
    expect(siteOf("docs.google.com")).toBe("google.com");
    expect(siteOf("www.google.com")).toBe("google.com");
    expect(siteOf("google.com")).toBe("google.com");
    expect(siteOf("jack-reacher.fandom.com")).toBe("fandom.com");
  });

  it("keeps three labels under a country code's second level", () => {
    expect(siteOf("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(siteOf("shop.example.com.au")).toBe("example.com.au");
    expect(siteOf("news.example.io")).toBe("example.io");
  });

  it("leaves addresses that aren't names alone", () => {
    expect(siteOf("192.168.1.10")).toBe("192.168.1.10");
    expect(siteOf("localhost")).toBe("localhost");
  });
});

describe("groupSites", () => {
  it("adds up a site's addresses and orders by blocks", () => {
    const groups = groupSites([
      { hostname: "www.google.com", count: 10 },
      { hostname: "news.example.org", count: 30 },
      { hostname: "docs.google.com", count: 25 },
      { hostname: "mail.google.com", count: 2 },
    ]);
    expect(groups.map((g) => [g.site, g.count])).toEqual([["google.com", 37], ["example.org", 30]]);
    expect(groups[0]!.members.map((m) => m.hostname)).toEqual(["docs.google.com", "www.google.com", "mail.google.com"]);
  });

  it("names a one-address group by its address", () => {
    const [one, many] = [groupSites([{ hostname: "www.nytimes.com", count: 1 }])[0]!, groupSites([{ hostname: "a.x.com", count: 1 }, { hostname: "b.x.com", count: 1 }])[0]!];
    expect(groupLabel(one)).toBe("nytimes.com");
    expect(groupLabel(many)).toBe("x.com");
  });
});
