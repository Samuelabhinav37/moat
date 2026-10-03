// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildHeatmap, buildPurposes, buildReachRows, busiestPhrase, heatLevel, purposeLabel, purposeShares } from "./insightsView";

const t = (_key: string, fallback: string) => fallback;
const span = () => document.createElement("span");

describe("purposes", () => {
  it("orders purposes largest first with shares that add up to one", () => {
    const shares = purposeShares({ site_analytics: 1, advertising: 3, social_media: 0 });
    expect(shares.map((s) => s.category)).toEqual(["advertising", "site_analytics"]);
    expect(shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1);
    expect(purposeShares({})).toEqual([]);
  });

  it("names TrackerDB categories in plain words, and unknown ones as Other", () => {
    expect(purposeLabel("site_analytics", t).name).toBe("Analytics");
    expect(purposeLabel("something_new", t).name).toBe("Other");
  });

  it("draws one split bar and a row per purpose", () => {
    const node = buildPurposes(document, { advertising: 59, site_analytics: 26 }, t);
    expect(node.querySelectorAll(".purp-bar span")).toHaveLength(2);
    expect(node.querySelector(".purp-row b")!.textContent).toBe("Advertising");
    expect(node.querySelector(".purp-bar")!.getAttribute("aria-label")).toBe("Advertising 69%, Analytics 31%");
  });
});

describe("purposeShares", () => {
  it("shows Other once: a category with no label of its own joins misc", () => {
    const shares = purposeShares({ advertising: 5, misc: 2, extensions: 3 });
    expect(shares.map((s) => [s.category, s.count])).toEqual([["advertising", 5], ["misc", 5]]);
  });
});

describe("buildReachRows", () => {
  it("says how many were blocked in the row, and links to the company when it has a site", () => {
    const node = buildReachRows(document, [{ company: "Google", icon: span(), sites: 2, ofSites: 7, blocks: 1335, description: "", seenOn: [], url: "https://about.google/" }], t);
    expect(node.querySelector(".rr-blocked")!.textContent).toBe("1,335 blocked");
    const learn = node.querySelector<HTMLAnchorElement>(".rr-learn")!;
    expect(learn.textContent).toBe("Learn more about Google");
    expect(learn.href).toBe("https://about.google/");
  });

  it("shows the share of your sites and opens to say where it was seen", () => {
    const node = buildReachRows(document, [{ company: "Google", icon: span(), sites: 41, ofSites: 58, blocks: 1268, description: "Ads and analytics.", seenOn: [{ hostname: "www.fandom.com", icon: span() }] }], t);
    expect(node.querySelector(".rr-pct")!.firstChild!.textContent).toBe("71%");
    const btn = node.querySelector<HTMLButtonElement>(".rr-btn")!;
    btn.click();
    expect(node.querySelector<HTMLElement>(".rr")!.dataset.open).toBe("true");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(node.querySelector(".rr-chip")!.textContent).toBe("fandom.com");
  });
});

describe("heatmap", () => {
  it("grades cells 0-4 against the busiest hour", () => {
    expect([heatLevel(0, 20), heatLevel(1, 20), heatLevel(10, 20), heatLevel(20, 20)]).toEqual([0, 1, 2, 4]);
  });

  it("draws 7 x 24 cells and names the busiest hour for screen readers", () => {
    const hours = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    hours[5]![21] = 9;
    const node = buildHeatmap(document, hours, ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"], t);
    expect(node.querySelectorAll(".heat i")).toHaveLength(168);
    expect(node.querySelector(".heat")!.getAttribute("aria-label")).toBe("Busiest: Wed at 21:00, 9 blocks");
    const wed = [...node.querySelectorAll("table.sr-only tr")].find((tr) => tr.firstElementChild?.textContent === "Wed");
    expect([...wed!.children].map((c) => c.textContent)).toEqual(["Wed", "9", "21:00"]);
  });

  it("says when blocks happen most, in words", () => {
    const hours = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    hours[1]![20] = 5;
    hours[3]![9] = 1;
    expect(busiestPhrase(hours, [false, true, true, false, false, false, false], t)).toBe("Weekend evenings");
  });
});
