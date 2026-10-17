// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildHighlight, buildWeekChart, changePercent, niceMax, type DayColumn } from "./overviewView";

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

  it("draws each bar at its true height, split by share", () => {
    // 57 on a 0-100 scale: the bar is 57% tall and its parts fill it.
    const chart = buildWeekChart(document, [day("Mon", 0, 0, 0), day("Today", 25, 31, 1, 0, true)], t);
    const stack = chart.querySelectorAll<HTMLElement>(".ovc-stack")[1]!;
    expect(parseFloat(stack.style.height)).toBeCloseTo(57, 5);
    const parts = [...stack.querySelectorAll<HTMLElement>(".ovc-seg")].map((s) => parseFloat(s.style.height));
    expect(parts[0]).toBeCloseTo((25 / 57) * 100, 5);
    expect(parts[1]).toBeCloseTo((31 / 57) * 100, 5);
    expect(parts[2]).toBe(3);
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


describe("buildHighlight", () => {
  it("says one headline over at most three rows, with a link to the page", () => {
    const icon = () => document.createElement("span");
    const card = buildHighlight(document, icon(), "Sites", "Fandom had the most blocked.", [1, 2, 3, 4].map((n) => ({ icon: icon(), name: `Site ${n}`, value: String(n) })), { href: "#sites", label: "All sites" });
    expect(card.querySelector(".ov-hl-kicker")?.textContent).toBe("Sites");
    expect(card.querySelector(".ov-hl-say")?.textContent).toBe("Fandom had the most blocked.");
    expect(card.querySelectorAll(".ov-hl-rows li")).toHaveLength(3);
    expect(card.querySelector<HTMLAnchorElement>(".ov-hl-link")?.getAttribute("href")).toBe("#sites");
  });
});
