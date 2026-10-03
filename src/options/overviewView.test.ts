// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildKpi, buildTopCard, buildWeekChart, changePercent, niceMax, type DayColumn } from "./overviewView";

const t = (_key: string, fallback: string) => fallback;
const day = (label: string, ads: number, trackers: number, popups: number, other = 0, today = false): DayColumn => ({ label, date: label, today, kinds: { ads, trackers, popups }, other });

describe("niceMax / changePercent", () => {
  it("rounds the chart's top line up to 1, 2 or 5 times a power of ten", () => {
    expect(niceMax(1704)).toBe(2000);
    expect(niceMax(39)).toBe(50);
    expect(niceMax(0)).toBe(10);
    expect(niceMax(100)).toBe(100);
  });

  it("compares with last week only when there was a last week", () => {
    expect(changePercent(4046, 2190)).toBe(85);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(5, null)).toBeNull();
    expect(changePercent(5, 0)).toBeNull();
  });
});

describe("buildWeekChart", () => {
  it("stacks each day's ads, trackers and pop-ups, labels the busiest day and today, and describes each column", () => {
    const chart = buildWeekChart(document, [day("Mon", 10, 20, 1), day("Tue", 60, 80, 2), day("Today", 1, 2, 0, 0, true)], t);
    const cols = chart.querySelectorAll(".ovc-col");
    expect(cols).toHaveLength(3);
    expect(cols[1]!.querySelectorAll(".ovc-seg")).toHaveLength(3);
    expect(cols[1]!.querySelector(".ovc-cap")!.textContent).toBe("142");
    expect(cols[2]!.querySelector(".ovc-cap")!.textContent).toBe("3");
    expect(cols[0]!.querySelector(".ovc-cap")).toBeNull();
    expect(cols[1]!.getAttribute("aria-label")).toBe("Tue: 142 (Ads 60, Trackers 80, Pop-ups 2)");
    expect(chart.querySelector(".ovc-grid span")!.textContent).toBe("200");
  });

  it("is one Tab stop on today; arrow keys move between days and Enter or a tap shows a day", () => {
    const chart = buildWeekChart(document, [day("Mon", 10, 20, 1), day("Tue", 60, 80, 2), day("Today", 1, 2, 0, 0, true)], t);
    document.body.replaceChildren(chart);
    const cols = [...chart.querySelectorAll<HTMLElement>(".ovc-col")];
    expect(cols.map((c) => c.tabIndex)).toEqual([-1, -1, 0]);
    expect(cols[0]!.getAttribute("role")).toBe("button");

    cols[2]!.focus();
    cols[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement).toBe(cols[1]);
    expect(cols.map((c) => c.tabIndex)).toEqual([-1, 0, -1]);

    cols[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cols[1]!.classList.contains("sel")).toBe(true);
    expect(cols[1]!.getAttribute("aria-pressed")).toBe("true");

    cols[0]!.click();
    expect(cols[0]!.classList.contains("sel")).toBe(true);
    expect(cols[1]!.classList.contains("sel")).toBe(false);
  });

  it("gives screen readers the numbers as a table", () => {
    const chart = buildWeekChart(document, [day("Mon", 10, 20, 1), day("Today", 1, 2, 0, 0, true)], t);
    const rows = [...chart.querySelectorAll("table.sr-only tr")].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ["Day", "Ads", "Trackers", "Pop-ups"],
      ["Mon", "10", "20", "1"],
      ["Today", "1", "2", "0"],
    ]);
  });

  it("shows older unsorted blocks as their own grey part, with a legend entry", () => {
    const chart = buildWeekChart(document, [day("Mon", 0, 0, 0, 30)], t);
    expect(chart.querySelector(".k-other")).not.toBeNull();
    expect(chart.querySelector(".ovc-legend")!.textContent).toContain("Not sorted");
  });
});

describe("buildKpi / buildTopCard", () => {
  it("shows the value, the change against last week, and a trend line", () => {
    const card = buildKpi(document, "Ads blocked", 1982, 82, [1, 2, 3], t);
    expect(card.querySelector(".ov-kpi-value")!.textContent).toBe("1,982");
    expect(card.querySelector(".ov-kpi-delta")!.textContent).toBe("↑ 82% vs last week");
    expect(card.querySelector("svg.ov-spark")).not.toBeNull();
    expect(buildKpi(document, "Pop-ups", 0, null, [0, 0], t).querySelector(".ov-kpi-delta, svg")).toBeNull();
  });

  it("lists up to five rows with a bar, or says it's empty", () => {
    const icon = () => document.createElement("span");
    const card = buildTopCard(document, "Who tracks you most", "Sites each company was on", [{ icon: icon(), name: "Google", value: "41", sub: "of 58", share: 41 / 58 }], "None yet", { href: "#trackers", label: "All trackers" });
    expect(card.querySelector(".ov-rank-name")!.textContent).toBe("Google");
    expect(card.querySelector(".ov-rank-value")!.textContent).toBe("41of 58");
    expect(card.querySelector<HTMLAnchorElement>(".ov-top-link")!.getAttribute("href")).toBe("#trackers");
    expect(buildTopCard(document, "Pages Moat stopped", "", [], "None this week").querySelector(".ov-top-empty")!.textContent).toBe("None this week");
  });
});
