// Settings Insights pages: who tracked you (reach rows), what they wanted
// (one share bar plus rows), when (a day x hour heatmap), and sites. DOM
// calls only, from the local weekly summary.
import type { Translate } from "./overviewView";

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** TrackerDB purposes in plain words, with a one-line "what it does". */
export const PURPOSES: Record<string, { key: string; name: string; descKey: string; desc: string }> = {
  advertising: { key: "purposeAdvertising", name: "Advertising", descKey: "purposeAdvertisingDesc", desc: "Builds a profile so ads follow you" },
  site_analytics: { key: "purposeAnalytics", name: "Analytics", descKey: "purposeAnalyticsDesc", desc: "Counts visits, clicks and scrolling" },
  social_media: { key: "purposeSocial", name: "Social", descKey: "purposeSocialDesc", desc: "Tells social networks what you read" },
  customer_interaction: { key: "purposeChat", name: "Chat and support", descKey: "purposeChatDesc", desc: "Logs what you look at" },
  audio_video_player: { key: "purposeVideo", name: "Video players", descKey: "purposeVideoDesc", desc: "Reports what you watch" },
  consent: { key: "purposeConsent", name: "Consent tools", descKey: "purposeConsentDesc", desc: "Cookie banners that also track" },
  hosting: { key: "purposeHosting", name: "Hosting", descKey: "purposeHostingDesc", desc: "Servers that carry tracking scripts" },
  utilities: { key: "purposeUtilities", name: "Utilities", descKey: "purposeUtilitiesDesc", desc: "Add-ons that also collect data" },
  pornvertising: { key: "purposeAdult", name: "Adult advertising", descKey: "purposeAdultDesc", desc: "Adult ad networks" },
  misc: { key: "purposeMisc", name: "Other", descKey: "purposeMiscDesc", desc: "Trackers with no single purpose" },
};

export function purposeLabel(category: string, t: Translate): { name: string; desc: string } {
  const p = PURPOSES[category] ?? PURPOSES.misc!;
  return { name: t(p.key, p.name), desc: t(p.descKey, p.desc) };
}

/** Purposes, largest first, with shares that add up to 1. */
export function purposeShares(purposes: Record<string, number>): { category: string; count: number; share: number }[] {
  const total = Object.values(purposes).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return Object.entries(purposes)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => ({ category, count, share: count / total }))
    .sort((a, b) => b.count - a.count);
}

export interface ReachRow {
  company: string;
  icon: HTMLElement;
  sites: number;
  ofSites: number;
  blocks: number;
  description: string;
  seenOn: { hostname: string; icon: HTMLElement }[];
}

/** One expandable row per company: share of your sites it was on. */
export function buildReachRows(doc: Document, rows: ReachRow[], t: Translate): HTMLElement {
  const list = el(doc, "div", "reach");
  rows.forEach((r, i) => {
    const item = el(doc, "div", "rr");
    item.dataset.open = "false";
    const btn = el(doc, "button", "rr-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    const name = el(doc, "span", "rr-name", r.company);
    const pct = Math.round((r.sites / Math.max(r.ofSites, 1)) * 100);
    const track = el(doc, "span", "rr-track");
    const fill = el(doc, "i");
    fill.style.width = `${Math.max(2, pct)}%`;
    fill.style.setProperty("--dl", `${i * 60}ms`);
    track.append(fill);
    const value = el(doc, "span", "rr-pct", `${pct}%`);
    value.append(el(doc, "small", "", t("insSitesOf", `${r.sites} of ${r.ofSites} sites`, [String(r.sites), String(r.ofSites)])));
    const chev = el(doc, "span", "rr-chev");
    chev.setAttribute("aria-hidden", "true");
    btn.append(r.icon, name, track, value, chev);
    const more = el(doc, "div", "rr-more");
    const inner = el(doc, "div", "rr-inner");
    if (r.description) inner.append(el(doc, "p", "rr-desc", r.description));
    if (r.seenOn.length) {
      const chips = el(doc, "div", "rr-chips");
      chips.append(el(doc, "span", "rr-chips-label", t("insSeenOn", "Seen on")));
      for (const s of r.seenOn) {
        const chip = el(doc, "span", "rr-chip");
        chip.append(s.icon, doc.createTextNode(s.hostname.replace(/^www\./, "")));
        chips.append(chip);
      }
      inner.append(chips);
    }
    inner.append(el(doc, "p", "rr-blocks", t("insBlockedRequests", `${r.blocks.toLocaleString()} requests blocked this week`, r.blocks.toLocaleString())));
    more.append(inner);
    btn.addEventListener("click", () => {
      const open = item.dataset.open !== "true";
      item.dataset.open = String(open);
      btn.setAttribute("aria-expanded", String(open));
    });
    item.append(btn, more);
    list.append(item);
  });
  return list;
}

/** One bar split by purpose, then a row for each purpose. */
export function buildPurposes(doc: Document, purposes: Record<string, number>, t: Translate): HTMLElement {
  const wrap = el(doc, "div", "purp");
  const shares = purposeShares(purposes);
  const bar = el(doc, "div", "purp-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", shares.map((s) => `${purposeLabel(s.category, t).name} ${Math.round(s.share * 100)}%`).join(", "));
  shares.forEach((s, i) => {
    const seg = el(doc, "span");
    seg.style.flex = String(s.count);
    seg.style.setProperty("--s", String(Math.min(i, 5)));
    seg.title = `${purposeLabel(s.category, t).name}: ${s.count.toLocaleString()}`;
    bar.append(seg);
  });
  wrap.append(bar);
  const rows = el(doc, "div", "purp-rows");
  shares.forEach((s, i) => {
    const label = purposeLabel(s.category, t);
    const row = el(doc, "div", "purp-row");
    const swatch = el(doc, "span", "purp-sw");
    swatch.style.setProperty("--s", String(Math.min(i, 5)));
    const text = el(doc, "div");
    text.append(el(doc, "b", "", label.name), el(doc, "small", "", label.desc));
    const value = el(doc, "span", "purp-val");
    value.append(el(doc, "b", "", `${Math.round(s.share * 100)}%`), el(doc, "small", "", s.count.toLocaleString()));
    row.append(swatch, text, value);
    rows.append(row);
  });
  wrap.append(rows);
  return wrap;
}

/** Heat level 0-4 for a count, against the grid's busiest hour. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

/** GitHub-style grid: one row per day, one cell per hour. */
export function buildHeatmap(doc: Document, hours: number[][], dayLabels: string[], t: Translate): HTMLElement {
  const wrap = el(doc, "div", "heatwrap");
  const grid = el(doc, "div", "heat");
  grid.setAttribute("role", "img");
  const max = Math.max(...hours.flat(), 0);
  let busiest = { day: 0, hour: 0, count: -1 };
  hours.forEach((row, d) => {
    grid.append(el(doc, "span", "heat-day", dayLabels[d] ?? ""));
    row.forEach((count, h) => {
      if (count > busiest.count) busiest = { day: d, hour: h, count };
      const cell = el(doc, "i", `l${heatLevel(count, max)}`);
      cell.dataset.tip = `${dayLabels[d] ?? ""} ${String(h).padStart(2, "0")}:00 · ${count.toLocaleString()}`;
      grid.append(cell);
    });
  });
  grid.append(el(doc, "span"));
  for (let h = 0; h < 24; h++) grid.append(el(doc, "span", "heat-hour", h % 6 === 0 ? String(h).padStart(2, "0") : ""));
  grid.setAttribute(
    "aria-label",
    busiest.count > 0
      ? t("insBusiestAria", `Busiest: ${dayLabels[busiest.day]} at ${busiest.hour}:00, ${busiest.count} blocks`, [dayLabels[busiest.day] ?? "", String(busiest.hour), String(busiest.count)])
      : t("insHeatEmpty", "No blocks yet this week")
  );
  const key = el(doc, "div", "heat-key");
  key.append(el(doc, "span", "", t("insLess", "Less")));
  for (let l = 0; l <= 4; l++) key.append(el(doc, "i", `l${l}`));
  key.append(el(doc, "span", "", t("insMore", "More")));
  wrap.append(grid, key);
  return wrap;
}

/** "Weekday evenings", "Weekend mornings"... from the busiest part of the grid. */
export function busiestPhrase(hours: number[][], weekendRows: boolean[], t: Translate): string {
  let best = { weekend: false, part: "", count: -1 };
  const parts: [string, string, number, number][] = [
    ["mornings", "insMornings", 6, 12],
    ["afternoons", "insAfternoons", 12, 18],
    ["evenings", "insEvenings", 18, 24],
    ["nights", "insNights", 0, 6],
  ];
  for (const weekend of [false, true]) {
    for (const [part, , from, to] of parts) {
      const rows = hours.filter((_, i) => (weekendRows[i] ?? false) === weekend);
      if (!rows.length) continue;
      const avg = rows.reduce((sum, r) => sum + r.slice(from, to).reduce((a, b) => a + b, 0), 0) / rows.length;
      if (avg > best.count) best = { weekend, part, count: avg };
    }
  }
  if (best.count <= 0) return t("insHeatEmpty", "No blocks yet this week");
  const p = parts.find((x) => x[0] === best.part)!;
  return best.weekend ? t(`${p[1]}Weekend`, `Weekend ${best.part}`) : t(`${p[1]}Weekday`, `Weekday ${best.part}`);
}
