import { describe, expect, it } from "vitest";
import { LIST_LABELS, groupLists, sectionFor } from "./filterListLabels";

const list = (group: string, category: string, entryCount = 1) => ({ group, category, entryCount });

describe("filter list labels", () => {
  it("groups lists into Ads, Tracking, Dangerous sites and Annoyances, in that order", () => {
    const groups = groupLists([list("scam", "security"), list("annoyances", "annoyance"), list("trackers", "ads"), list("popups", "ads"), list("ads", "ads")]);
    expect(groups.map((g) => g.section)).toEqual(["ads", "tracking", "security", "annoyance"]);
    expect(groups[0]!.lists.map((l) => l.group)).toEqual(["ads", "popups"]);
  });

  it("files the tracker list under Tracking even though its manifest category is ads", () => {
    expect(sectionFor("trackers", "ads")).toBe("tracking");
    expect(sectionFor("url-tracking", "ads")).toBe("tracking");
  });

  it("keeps a list it doesn't know, by its manifest category, after the known ones", () => {
    expect(sectionFor("brand-new", "security")).toBe("security");
    const groups = groupLists([list("brand-new", "security", 999), list("scam", "security", 1)]);
    expect(groups[0]!.lists.map((l) => l.group)).toEqual(["scam", "brand-new"]);
  });

  it("names every list the build ships", () => {
    for (const group of ["ads", "popups", "oisd", "trackers", "url-tracking", "phishing-urls", "scam", "malicious-urls", "badware", "cookie-notices", "social-widgets", "annoyances"]) {
      expect(LIST_LABELS[group], group).toBeDefined();
    }
  });
});
