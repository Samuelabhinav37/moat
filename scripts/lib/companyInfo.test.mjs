import { describe, it, expect } from "vitest";
import { buildCompanyInfo } from "./companyInfo.mjs";

const trackerDb = {
  organizations: {
    o1: { name: "Google", description: "  Online advertising and search.  ", website_url: "https://www.google.com" },
    o2: { name: "Criteo", description: "Retargeting ad network.", website_url: "  https://www.criteo.com  " },
    o3: { name: "NoDesc", description: "   ", website_url: "https://nodesc.example" },
    o4: { name: "NoUrl", description: "Has a description but no site.", website_url: "" },
    o5: { name: "Unattributed", description: "Never referenced by a rule.", website_url: "https://x.example" },
  },
};

describe("buildCompanyInfo", () => {
  it("maps attributed names to trimmed description + url", () => {
    const info = buildCompanyInfo(["Google", "Criteo"], trackerDb);
    expect(info).toEqual({
      Google: { description: "Online advertising and search.", url: "https://www.google.com" },
      Criteo: { description: "Retargeting ad network.", url: "https://www.criteo.com" },
    });
  });

  it("drops companies with a blank or missing description", () => {
    const info = buildCompanyInfo(["Google", "NoDesc"], trackerDb);
    expect(Object.keys(info)).toEqual(["Google"]);
  });

  it("keeps a described company that has no website, with url null", () => {
    const info = buildCompanyInfo(["NoUrl"], trackerDb);
    expect(info.NoUrl).toEqual({ description: "Has a description but no site.", url: null });
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
