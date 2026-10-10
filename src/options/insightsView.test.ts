// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildDays, buildPurposes, buildReachRows, busiestDayPhrase, busiestWindow, companyBlurb, purposeLabel, purposeShares } from "./insightsView";

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

  it("draws a row per purpose with its own bar, folding small ones into Other", () => {
    const node = buildPurposes(document, { advertising: 50, site_analytics: 20, social_media: 10, consent: 8, audio_video_player: 7, hosting: 5 }, t);
    const names = [...node.querySelectorAll(".purp-row b")].map((b) => b.textContent);
    expect(names).toEqual(["Advertising", "Analytics", "Social", "Consent tools", "Other"]);
    expect(node.querySelectorAll(".purp-track i")).toHaveLength(5);
    expect(node.querySelector(".purp-row:last-child .purp-val")!.textContent).toBe("12%");
  });
});

describe("purposeShares", () => {
  it("shows Other once: a category with no label of its own joins misc", () => {
    const shares = purposeShares({ advertising: 5, misc: 2, extensions: 3 });
    expect(shares.map((s) => [s.category, s.count])).toEqual([["advertising", 5], ["misc", 5]]);
  });
});

describe("companyBlurb", () => {
  it("puts back a missing name and keeps it short", () => {
    expect(companyBlurb("Imgur", "is an online image sharing community and image host.")).toBe("Imgur is an online image sharing community and image host.");
    const long = "First sentence here. " + "Another long sentence that keeps going on and on about the company. ".repeat(6);
    expect(companyBlurb("X", long).length).toBeLessThanOrEqual(260);
    expect(companyBlurb("X", "")).toBe("");
  });
});

describe("buildReachRows", () => {
  it("says how many sites and how many blocked, and links to the company", () => {
    const node = buildReachRows(document, [{ company: "Google", icon: span(), sites: 2, ofSites: 7, blocks: 1335, description: "", seenOn: [], url: "https://about.google/" }], t);
    expect(node.querySelector(".rr-sub")!.textContent).toBe("On 2 of your 7 sites");
    expect(node.querySelector(".rr-pct b")!.textContent).toBe("1,335");
    const learn = node.querySelector<HTMLAnchorElement>(".rr-learn")!;
    expect(learn.textContent).toBe("Learn more about Google");
    expect(learn.href).toBe("https://about.google/");
  });

  it("opens to the sites it was on, each opening that site", () => {
    const opened: string[] = [];
    const node = buildReachRows(document, [{ company: "Google", icon: span(), sites: 41, ofSites: 58, blocks: 1268, description: "Ads and analytics.", seenOn: [{ hostname: "www.fandom.com", icon: span() }] }], t, (h) => opened.push(h));
    const btn = node.querySelector<HTMLButtonElement>(".rr-btn")!;
    btn.click();
    expect(node.querySelector<HTMLElement>(".rr")!.dataset.open).toBe("true");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const site = node.querySelector<HTMLButtonElement>(".rr-site")!;
    expect(site.textContent).toBe("fandom.com");
    site.click();
    expect(opened).toEqual(["www.fandom.com"]);
    expect(node.querySelector(".rr-site-more")!.textContent).toBe("and 40 more");
  });
});

describe("days", () => {
  const day = (name: string, total: number, peak = 20) => ({ label: name.slice(0, 3), name, total, hours: Array.from({ length: 24 }, (_, h) => (h === peak ? total : 0)), topSites: [{ hostname: "a.example", count: total, icon: span() }] });

  it("finds a day's busiest four hours", () => {
    const hours = new Array<number>(24).fill(0);
    hours[19] = 5;
    hours[21] = 4;
    expect(busiestWindow(hours)).toEqual({ from: 18, count: 9 });
  });

  it("starts on the busiest day and says where it happened", () => {
    const node = buildDays(document, [day("Monday", 3), day("Friday", 90), day("Today", 1)], t);
    expect(node.querySelectorAll(".day-bar")).toHaveLength(3);
    expect(node.querySelector('[aria-selected="true"]')!.getAttribute("aria-label")).toBe("Friday: 90");
    expect(node.querySelector(".days-line b")!.textContent).toBe("Friday");
    expect(node.querySelector(".days-sites .rr-site")!.textContent).toBe("a.example90");
    node.querySelectorAll<HTMLButtonElement>(".day-bar")[0]!.click();
    expect(node.querySelector(".days-line b")!.textContent).toBe("Monday");
  });

  it("names the busiest day in words", () => {
    expect(busiestDayPhrase([{ name: "Monday", total: 2 }, { name: "Friday", total: 9 }], t)).toBe("Friday was the busiest day. Pick a day to see where.");
    expect(busiestDayPhrase([{ name: "Monday", total: 0 }], t)).toBe("No blocks yet this week");
  });
});
