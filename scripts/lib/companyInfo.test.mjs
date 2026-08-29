import { describe, it, expect } from "vitest";
import { buildCompanyInfo } from "./companyInfo.mjs";

const trackerDb = {
  organizations: {
    o1: { name: "Google", description: "  Online advertising and search across the web.  ", website_url: "https://www.google.com" },
    o2: { name: "Criteo", description: "Retargeting ad network for e-commerce sites. It also runs a marketplace.", website_url: "  https://www.criteo.com  " },
    o3: { name: "NoDesc", description: "   ", website_url: "https://nodesc.example" },
    o4: { name: "NoUrl", description: "Has a description but no listed website at all.", website_url: "" },
    o5: { name: "Unattributed", description: "Never referenced by a rule.", website_url: "https://x.example" },
    o6: { name: "Abbrev", description: "Foo Inc. builds analytics tools for large publishers.", website_url: "https://foo.example" },
  },
};

describe("buildCompanyInfo", () => {
  it("maps attributed names to a trimmed, first-sentence description + url", () => {
    const info = buildCompanyInfo(["Google", "Criteo"], trackerDb);
    expect(info).toEqual({
      Google: { description: "Online advertising and search across the web.", url: "https://www.google.com" },
      Criteo: { description: "Retargeting ad network for e-commerce sites.", url: "https://www.criteo.com" },
    });
  });

  it("keeps the whole string when the first sentence is just an abbreviation", () => {
    const info = buildCompanyInfo(["Abbrev"], trackerDb);
    expect(info.Abbrev.description).toBe("Foo Inc. builds analytics tools for large publishers.");
  });

  it("drops companies with a blank or missing description", () => {
    const info = buildCompanyInfo(["Google", "NoDesc"], trackerDb);
    expect(Object.keys(info)).toEqual(["Google"]);
  });

  it("keeps a described company that has no website, with url null", () => {
    const info = buildCompanyInfo(["NoUrl"], trackerDb);
    expect(info.NoUrl).toEqual({ description: "Has a description but no listed website at all.", url: null });
  });

  it("only includes names actually passed in, not the whole catalog", () => {
    const info = buildCompanyInfo(["Google"], trackerDb);
    expect(info.Unattributed).toBeUndefined();
    expect(Object.keys(info)).toHaveLength(1);
  });

  it("accepts a Set and ignores names TrackerDB doesn't know", () => {
    const info = buildCompanyInfo(new Set(["Google", "GhostCorp"]), trackerDb);
    expect(Object.keys(info)).toEqual(["Google"]);
  });
});
