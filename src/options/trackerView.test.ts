import { describe, expect, it } from "vitest";
import { joinCompanyBreakdown } from "./trackerView";

const info = {
  Google: { description: "Search and ads.", url: "https://www.google.com" },
  Criteo: { description: "Retargeting.", url: null },
};

describe("joinCompanyBreakdown", () => {
  it("sorts by count descending, then company name ascending", () => {
    const rows = joinCompanyBreakdown({ Criteo: 2, Google: 9, Amazon: 2 }, info);
    expect(rows.map((r) => r.company)).toEqual(["Google", "Amazon", "Criteo"]);
  });

  it("attaches description and url when known", () => {
    const [row] = joinCompanyBreakdown({ Google: 3 }, info);
    expect(row).toEqual({ company: "Google", count: 3, description: "Search and ads.", url: "https://www.google.com" });
  });

  it("falls back to empty description and null url for an unknown company", () => {
    const [row] = joinCompanyBreakdown({ Mystery: 1 }, info);
    expect(row).toEqual({ company: "Mystery", count: 1, description: "", url: null });
  });

  it("returns [] for an empty breakdown", () => {
    expect(joinCompanyBreakdown({}, info)).toEqual([]);
  });
});
