// Settings Overview: the week's blocks as stacked columns, three number
// cards with a trend line, and three short top-5 lists. Built with DOM calls
// only (no innerHTML), from the local weekly summary (shared/usageStatsState).
import type { BlockKinds } from "../types";

export type Translate = (key: string, fallback: string, substitutions?: string | string[]) => string;

const SVG_NS = "http://www.w3.org/2000/svg";
const KINDS = ["ads", "trackers", "popups"] as const;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A round number at or above `max` for the chart's top line (1, 2, 5 x 10^n). */
export function niceMax(max: number): number {
  if (max <= 0) return 10;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

/** "+85%" / "-12%" against last week, or null when there's nothing to compare. */
export function changePercent(now: number, before: number | null | undefined): number | null {
  if (before === null || before === undefined || before <= 0) return null;
  return Math.round((now / before - 1) * 100);
}

export interface DayColumn {
  label: string;
  date: string;
  today: boolean;
  kinds: BlockKinds;
  /** Blocks that day the split doesn't cover (days recorded before kinds were). */
  other: number;
}

export function buildWeekChart(doc: Document, days: DayColumn[], t: Translate): HTMLElement {
  const wrap = el(doc, "div", "ovc");
  const totals = days.map((d) => d.kinds.ads + d.kinds.trackers + d.kinds.popups + d.other);
  const top = niceMax(Math.max(...totals, 0));
  const grid = el(doc, "div", "ovc-grid");
  grid.setAttribute("aria-hidden", "true");
  for (const f of [1, 0.5, 0]) {
    const line = el(doc, "div", "ovc-line");
    line.style.bottom = `${f * 100}%`;
    line.append(el(doc, "span", "", Math.round(top * f).toLocaleString()));
    grid.append(line);
  }
  const plot = el(doc, "div", "ovc-plot");
  plot.append(grid);
  const busiest = totals.indexOf(Math.max(...totals));
  const names: Record<(typeof KINDS)[number], string> = {
    ads: t("ovKindAdsTitle", "Ads"),
    trackers: t("ovKindTrackersTitle", "Trackers"),
    popups: t("ovKindPopupsTitle", "Pop-ups"),
  };
  days.forEach((day, i) => {
    const total = totals[i]!;
    const col = el(doc, "div", day.today ? "ovc-col today" : "ovc-col");
    // Each day is a button: Tab reaches the chart once (on today), arrow keys
    // move between days, and focus, a tap or Enter shows the day's split.
    col.setAttribute("role", "button");
    col.setAttribute("aria-pressed", "false");
    col.tabIndex = i === days.length - 1 ? 0 : -1;
    col.setAttribute(
      "aria-label",
      `${day.label}: ${total.toLocaleString()} (${KINDS.map((k) => `${names[k]} ${day.kinds[k].toLocaleString()}`).join(", ")})`
    );
    if (total > 0 && (i === busiest || day.today)) col.append(el(doc, "span", "ovc-cap", total.toLocaleString()));
    const stack = el(doc, "div", "ovc-stack");
    stack.style.setProperty("--dl", `${i * 45}ms`);
    const segment = (count: number, cls: string) => {
      if (count <= 0) return;
      const seg = el(doc, "span", `ovc-seg ${cls}`);
      // A share of this day's bar, which is already sized against the scale.
      seg.style.height = `${Math.max(3, (count / total) * 100)}%`;
      stack.append(seg);
    };
    segment(day.kinds.ads, "k-ads");
    segment(day.kinds.trackers, "k-trackers");
    segment(day.kinds.popups, "k-popups");
    segment(day.other, "k-other");
    stack.style.height = `${(total / top) * 100}%`;
    col.append(stack);
    // The day's split, shown on hover, focus or tap (the label already reads it out).
    const tip = el(doc, "span", "ovc-tip");
    tip.setAttribute("aria-hidden", "true");
    tip.append(el(doc, "b", "", `${day.label} · ${total.toLocaleString()}`));
    for (const k of KINDS) {
      const row = el(doc, "span", "ovc-tip-row");
      const name = el(doc, "span");
      name.append(el(doc, "i", `key k-${k}`), doc.createTextNode(names[k]));
      row.append(name, el(doc, "b", "", day.kinds[k].toLocaleString()));
      tip.append(row);
    }
    col.append(tip);
    plot.append(col);
  });
  const labels = el(doc, "div", "ovc-days");
  for (const day of days) labels.append(el(doc, "span", day.today ? "today" : "", day.label));
  // The legend doubles as the week's totals: "Ads 1,982".
  const legend = el(doc, "div", "ovc-legend");
  for (const k of KINDS) {
    const item = el(doc, "span");
    const total = days.reduce((sum, day) => sum + day.kinds[k], 0);
    item.append(el(doc, "i", `key k-${k}`), doc.createTextNode(names[k]), el(doc, "b", "", total.toLocaleString()));
    legend.append(item);
  }
  if (days.some((d) => d.other > 0)) {
    const item = el(doc, "span");
    item.append(el(doc, "i", "key k-other"), doc.createTextNode(t("ovKindOtherTitle", "Not sorted")));
    legend.append(item);
  }
  plot.setAttribute("role", "group");
  plot.setAttribute("aria-label", t("ovChartGroup", "Blocked per day. Use the arrow keys to move between days."));
  const cols = () => [...plot.querySelectorAll<HTMLElement>(".ovc-col")];
  const select = (col: HTMLElement | null) => {
    for (const c of cols()) {
      const on = c === col;
      c.classList.toggle("sel", on);
      c.setAttribute("aria-pressed", String(on));
    }
  };
  plot.addEventListener("click", (event) => {
    const col = (event.target as HTMLElement).closest<HTMLElement>(".ovc-col");
    if (col) select(col.classList.contains("sel") ? null : col);
  });
  plot.addEventListener("keydown", (event) => {
    const col = (event.target as HTMLElement).closest<HTMLElement>(".ovc-col");
    if (!col) return;
    const all = cols();
    const i = all.indexOf(col);
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: all.length - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      const target = all[Math.max(0, Math.min(all.length - 1, next))]!;
      for (const c of all) c.tabIndex = c === target ? 0 : -1;
      target.focus();
      if (col.classList.contains("sel")) select(target);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(col.classList.contains("sel") ? null : col);
    } else if (event.key === "Escape") {
      select(null);
    }
  });
  // The same numbers as a table, for screen readers.
  const table = el(doc, "table", "sr-only");
  table.append(el(doc, "caption", "", t("ovChartTable", "Blocked per day")));
  const head = el(doc, "tr");
  head.append(el(doc, "th", "", t("ovChartDay", "Day")), ...KINDS.map((k) => el(doc, "th", "", names[k])));
  table.append(head);
  for (const day of days) {
    const tr = el(doc, "tr");
    tr.append(el(doc, "th", "", day.label), ...KINDS.map((k) => el(doc, "td", "", day.kinds[k].toLocaleString())));
    table.append(tr);
  }
  wrap.append(plot, labels, legend, table);
  return wrap;
}

function sparkline(doc: Document, values: number[]): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ov-spark");
  svg.setAttribute("viewBox", "0 0 300 44");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [values.length > 1 ? (i * 300) / (values.length - 1) : 0, 6 + 32 * (1 - (v - min) / (max - min || 1))] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = doc.createElementNS(SVG_NS, "path");
  area.setAttribute("class", "ov-spark-area");
  area.setAttribute("d", `${d} L300 44 L0 44Z`);
  const line = doc.createElementNS(SVG_NS, "path");
  line.setAttribute("class", "ov-spark-line");
  line.setAttribute("d", d);
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(area, line);
  return svg;
}

export function buildKpi(doc: Document, label: string, value: number, change: number | null, series: number[], t: Translate, note?: string): HTMLElement {
  const card = el(doc, "div", "ov-kpi");
  card.append(el(doc, "div", "ov-kpi-label", label));
  const row = el(doc, "div", "ov-kpi-row");
  row.append(el(doc, "span", "ov-kpi-value", value.toLocaleString()));
  if (change !== null) {
    const text = change >= 0 ? t("ovChangeUp", `↑ ${change}%`, String(change)) : t("ovChangeDown", `↓ ${Math.abs(change)}%`, String(Math.abs(change)));
    const delta = el(doc, "span", "ov-kpi-delta");
    delta.append(el(doc, "b", "", text), el(doc, "span", "ov-kpi-vs", ` ${t("ovVsLastWeek", "vs last week")}`));
    row.append(delta);
  }
  // A plain sentence where a percentage would mean little ("on 4 of 7 sites").
  if (note) row.append(el(doc, "span", "ov-kpi-delta", note));
  card.append(row);
  if (series.some((v) => v > 0)) card.append(sparkline(doc, series));
  return card;
}

export interface RankRow {
  icon: HTMLElement;
  name: string;
  value: string;
  sub?: string;
  /** 0..1 share for the bar, or null for no bar. */
  share: number | null;
  title?: string;
}

export function buildTopCard(doc: Document, title: string, takeaway: string, rows: RankRow[], empty: string, link?: { href: string; label: string }): HTMLElement {
  const card = el(doc, "div", "ov-top");
  const head = el(doc, "div", "ov-top-head");
  head.append(el(doc, "h2", "", title), el(doc, "p", "", takeaway));
  card.append(head);
  if (!rows.length) {
    card.append(el(doc, "p", "ov-top-empty", empty));
  } else {
    const list = el(doc, "ol", "ov-rank");
    rows.forEach((r, i) => {
      const li = el(doc, "li");
      if (r.title) li.title = r.title;
      const text = el(doc, "div", "ov-rank-text");
      text.append(el(doc, "span", "ov-rank-name", r.name));
      if (r.share !== null) {
        const bar = el(doc, "span", "ov-rank-bar");
        const fill = el(doc, "i");
        fill.style.width = `${Math.max(2, Math.min(1, r.share) * 100)}%`;
        fill.style.setProperty("--dl", `${i * 50}ms`);
        bar.append(fill);
        text.append(bar);
      }
      const value = el(doc, "span", "ov-rank-value", r.value);
      if (r.sub) value.append(el(doc, "small", "", r.sub));
      li.append(el(doc, "span", "ov-rank-pos", String(i + 1)), r.icon, text, value);
      list.append(li);
    });
    card.append(list);
  }
  if (link) {
    const a = el(doc, "a", "ov-top-link", `${link.label} ›`);
    a.href = link.href;
    card.append(a);
  }
  return card;
}
