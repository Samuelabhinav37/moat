// Settings Insights pages: who tracked you (one row per company), why (a
// row per purpose), and when (the week's days, each opening to where it
// happened). DOM calls only, from the local weekly summary.
import { siteName } from "../shared/siteName";
import type { Translate } from "./overviewView";

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** TrackerDB purposes in plain words, with a one-line "what it does". */
export const PURPOSES: Record<string, { key: string; name: string; descKey: string; desc: string }> = {
  advertising: { key: "purposeAdvertising", name: "Advertising", descKey: "purposeAdvertisingDesc", desc: "Pick the ads you see" },
  site_analytics: { key: "purposeAnalytics", name: "Analytics", descKey: "purposeAnalyticsDesc", desc: "Record what you click and read" },
  social_media: { key: "purposeSocial", name: "Social", descKey: "purposeSocialDesc", desc: "Tell social networks what you read" },
  customer_interaction: { key: "purposeChat", name: "Chat and support", descKey: "purposeChatDesc", desc: "Chat boxes that log the pages you view" },
  audio_video_player: { key: "purposeVideo", name: "Video players", descKey: "purposeVideoDesc", desc: "Video players that report what you watch" },
  consent: { key: "purposeConsent", name: "Consent tools", descKey: "purposeConsentDesc", desc: "Cookie banners that also track you" },
  hosting: { key: "purposeHosting", name: "Hosting", descKey: "purposeHostingDesc", desc: "Servers that deliver tracking scripts" },
  utilities: { key: "purposeUtilities", name: "Utilities", descKey: "purposeUtilitiesDesc", desc: "Page add-ons that also collect data" },
  pornvertising: { key: "purposeAdult", name: "Adult advertising", descKey: "purposeAdultDesc", desc: "Adult ad networks" },
  misc: { key: "purposeMisc", name: "Other", descKey: "purposeMiscDesc", desc: "Mixed or unknown" },
};

export function purposeLabel(category: string, t: Translate): { name: string; desc: string } {
  const p = PURPOSES[category] ?? PURPOSES.misc!;
  return { name: t(p.key, p.name), desc: t(p.descKey, p.desc) };
}

/** Purposes, largest first, with shares that add up to 1. A category with
 * no label of its own (TrackerDB's "extensions", or a new one) joins
 * "misc", so "Other" appears once. */
export function purposeShares(purposes: Record<string, number>): { category: string; count: number; share: number }[] {
  const merged: Record<string, number> = {};
  for (const [category, count] of Object.entries(purposes)) {
    if (count <= 0) continue;
    const key = PURPOSES[category] ? category : "misc";
    merged[key] = (merged[key] ?? 0) + count;
  }
  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return Object.entries(merged)
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
  /** The company's own page, to learn more about it. */
  url?: string | null;
}

/** A company's description as one or two plain sentences. Some entries in
 * the tracker database drop the name ("is an online image host."), and
 * some run to a paragraph. */
export function companyBlurb(company: string, description: string): string {
  let text = description.trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (/^(is|are|was|provides|offers|operates|develops)\b/.test(text)) text = `${company} ${text}`;
  text = text.charAt(0).toUpperCase() + text.slice(1);
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = "";
  for (const sentence of sentences) {
    if (out && out.length + sentence.length > 220) break;
    out += sentence;
  }
  if (out.length > 260) out = `${out.slice(0, 257).replace(/\s+\S*$/, "")}…`;
  return out.trim();
}

/** A site as a small button that opens its panel on Sites. */
function siteButton(doc: Document, site: { hostname: string; icon: HTMLElement; count?: number }, t: Translate, onSite?: (hostname: string) => void): HTMLLIElement {
  const li = el(doc, "li");
  const name = siteName(site.hostname);
  const open = el(doc, "button", "rr-site");
  open.type = "button";
  open.append(site.icon, el(doc, "span", "", name));
  if (site.count !== undefined) open.append(el(doc, "small", "", site.count.toLocaleString()));
  open.title = t("insOpenSite", `See ${site.hostname.replace(/^www\./, "")} on Sites`, site.hostname.replace(/^www\./, ""));
  open.addEventListener("click", () => onSite?.(site.hostname));
  li.append(open);
  return li;
}

/** Where a company was seen, by site name: "On Fandom and LinkedIn", or
 * "On Fandom, LinkedIn and 3 more" past two. */
export function seenOnLine(r: Pick<ReachRow, "seenOn" | "sites">, t: Translate): string {
  const names = [...new Set(r.seenOn.map((s) => siteName(s.hostname)))];
  if (!names.length) return "";
  const shown = names.slice(0, 2);
  // Addresses not in seenOn still count; several addresses of one site don't.
  const more = names.length - shown.length + Math.max(0, r.sites - r.seenOn.length);
  const list = new Intl.ListFormat(undefined, { type: "conjunction" }).format(more ? [...shown, t("insMoreSites", `${more} more`, String(more))] : shown);
  return t("insSeenOnLine", `On ${list}`, list);
}

/** One row per company, most sites first. A row opens to what the company
 * is and the sites it was on (most blocks first); each site opens its own
 * panel on Sites through `onSite`. */
export function buildReachRows(doc: Document, rows: ReachRow[], t: Translate, onSite?: (hostname: string) => void): HTMLElement {
  const list = el(doc, "div", "reach");
  rows.forEach((r, i) => {
    const item = el(doc, "div", "rr");
    item.dataset.open = "false";
    item.dataset.search = r.company;
    item.dataset.company = r.company;
    const btn = el(doc, "button", "rr-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    const text = el(doc, "span", "rr-text");
    text.append(el(doc, "span", "rr-name", r.company));
    const where = seenOnLine(r, t);
    if (where) text.append(el(doc, "small", "rr-sub", where));
    item.style.setProperty("--dl", `${Math.min(i, 8) * 40}ms`);
    const value = el(doc, "span", "rr-pct");
    value.append(el(doc, "b", "", r.blocks.toLocaleString()), el(doc, "small", "rr-blocked", t("insBlockedWord", "blocked")));
    const chev = el(doc, "span", "rr-chev");
    chev.setAttribute("aria-hidden", "true");
    btn.append(r.icon, text, value, chev);

    const more = el(doc, "div", "rr-more");
    const inner = el(doc, "div", "rr-inner");
    const blurb = companyBlurb(r.company, r.description);
    if (blurb) inner.append(el(doc, "p", "rr-desc", blurb));
    if (r.seenOn.length) {
      inner.append(el(doc, "h4", "rr-label", t("insSeenOnTitle", "Where it was")));
      const sites = el(doc, "ul", "rr-sites");
      for (const s of r.seenOn) sites.append(siteButton(doc, s, t, onSite));
      if (r.sites > r.seenOn.length) sites.append(el(doc, "li", "rr-site-more", t("siteCompaniesMore", `and ${r.sites - r.seenOn.length} more`, String(r.sites - r.seenOn.length))));
      inner.append(sites);
    }
    if (r.url) {
      const learn = el(doc, "a", "rr-learn", t("insLearnMore", `Learn more about ${r.company}`, r.company));
      learn.href = r.url;
      learn.target = "_blank";
      learn.rel = "noopener";
      inner.append(learn);
    }
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

/** How many purposes get a row of their own; the rest join "Other". */
export const PURPOSE_ROWS = 4;

/** Parts of a whole, the way iPhone Storage shows them: one bar split by
 * purpose, then a row per purpose with its colour, what that kind of
 * tracker does, and its share. Largest first; the rest join "Other". */
export function buildPurposes(doc: Document, purposes: Record<string, number>, t: Translate): HTMLElement {
  const shares = purposeShares(purposes);
  const shown = shares.slice(0, PURPOSE_ROWS);
  const rest = shares.slice(PURPOSE_ROWS);
  if (rest.length) {
    const extra = rest.reduce((sum, s) => ({ count: sum.count + s.count, share: sum.share + s.share }), { count: 0, share: 0 });
    const misc = shown.findIndex((s) => s.category === "misc");
    if (misc >= 0) shown[misc] = { category: "misc", count: shown[misc]!.count + extra.count, share: shown[misc]!.share + extra.share };
    else shown.push({ category: "misc", ...extra });
  }
  // "Other" always last, so the colours read in order of size.
  shown.sort((a, b) => Number(a.category === "misc") - Number(b.category === "misc") || b.share - a.share);
  const wrap = el(doc, "div", "purp");
  const bar = el(doc, "div", "purp-bar");
  bar.setAttribute("aria-hidden", "true");
  const list = el(doc, "div", "purp-rows");
  shown.forEach((s, i) => {
    const label = purposeLabel(s.category, t);
    const pct = Math.round(s.share * 100);
    const swatch = s.category === "misc" ? "misc" : String(i);
    const seg = el(doc, "i", `purp-seg s-${swatch}`);
    seg.style.flexGrow = String(Math.max(s.share, 0.01));
    seg.style.setProperty("--dl", `${i * 70}ms`);
    bar.append(seg);
    const row = el(doc, "div", "purp-row");
    const text = el(doc, "div", "purp-text");
    text.append(el(doc, "b", "", label.name), el(doc, "small", "", label.desc));
    row.append(el(doc, "span", `purp-key s-${swatch}`), text, el(doc, "span", "purp-val", `${pct}%`));
    list.append(row);
  });
  wrap.append(bar, list);
  return wrap;
}

/** The busiest stretch of a day, as the start of a four-hour window. */
export function busiestWindow(hours: readonly number[]): { from: number; count: number } {
  let best = { from: 0, count: 0 };
  for (let from = 0; from <= 20; from++) {
    const count = hours.slice(from, from + 4).reduce((a, b) => a + b, 0);
    if (count > best.count) best = { from, count };
  }
  return best;
}

function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour % 24).toLocaleTimeString(undefined, { hour: "numeric" });
}

export interface DayData {
  /** Short name under the bar ("Fri", "Today"). */
  label: string;
  /** Long name for sentences ("Friday", "Today"). */
  name: string;
  total: number;
  hours: readonly number[];
  topSites: { hostname: string; count: number; icon: HTMLElement }[];
}

/** The week as seven bars. Pressing a day says when in the day it was
 * busiest and on which sites; the busiest day is picked to start with. */
export function buildDays(doc: Document, days: DayData[], t: Translate, onSite?: (hostname: string) => void): HTMLElement {
  const wrap = el(doc, "div", "days");
  const bars = el(doc, "div", "days-bars");
  bars.setAttribute("role", "tablist");
  bars.setAttribute("aria-label", t("insDaysLabel", "Days this week"));
  const detail = el(doc, "div", "days-detail");
  detail.setAttribute("role", "tabpanel");
  const max = Math.max(...days.map((d) => d.total), 1);
  const buttons: HTMLButtonElement[] = [];

  const select = (index: number) => {
    buttons.forEach((b, i) => {
      b.setAttribute("aria-selected", String(i === index));
      b.tabIndex = i === index ? 0 : -1;
    });
    const day = days[index]!;
    if (day.total <= 0) {
      detail.replaceChildren(el(doc, "p", "days-line", t("insDayNone", `Nothing blocked on ${day.name}.`, day.name)));
      return;
    }
    const window = busiestWindow(day.hours);
    const line = el(doc, "p", "days-line");
    const total = day.total.toLocaleString();
    line.append(
      el(doc, "b", "", day.name),
      doc.createTextNode(
        ` ${
          window.count > 0
            ? t("insDayLine", `${total} blocked, most between ${hourLabel(window.from)} and ${hourLabel(window.from + 4)}.`, [total, hourLabel(window.from), hourLabel(window.from + 4)])
            : t("insDayTotal", `${total} blocked.`, total)
        }`
      )
    );
    const parts: HTMLElement[] = [line];
    if (day.topSites.length) {
      const sites = el(doc, "ul", "rr-sites days-sites");
      for (const s of day.topSites) sites.append(siteButton(doc, s, t, onSite));
      parts.push(el(doc, "h4", "rr-label", t("insDayWhere", "Mostly on")), sites);
    }
    detail.replaceChildren(...parts);
  };

  days.forEach((day, i) => {
    const b = el(doc, "button", "day-bar");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-label", `${day.name}: ${day.total.toLocaleString()}`);
    const col = el(doc, "span", "day-col");
    const fill = el(doc, "i");
    fill.style.height = `${day.total > 0 ? Math.max(4, (day.total / max) * 100) : 0}%`;
    col.append(fill);
    b.append(col, el(doc, "span", "day-label", day.label));
    b.addEventListener("click", () => select(i));
    b.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = (i + step + days.length) % days.length;
      select(next);
      buttons[next]!.focus();
    });
    buttons.push(b);
    bars.append(b);
  });
  if (days.length) select(days.reduce((best, d, i) => (d.total > days[best]!.total ? i : best), days.length - 1));
  wrap.append(bars, detail);
  return wrap;
}

/** "Friday, mostly between 6 PM and 10 PM." from the week's totals and that
 * day's hours. */
export function busiestDayPhrase(days: readonly { name: string; total: number; hours?: readonly number[] }[], t: Translate): string {
  const best = days.reduce<{ name: string; total: number; hours?: readonly number[] } | null>((b, d) => (d.total > (b?.total ?? 0) ? d : b), null);
  if (!best) return t("insHeatEmpty", "No blocks yet this week");
  const window = best.hours ? busiestWindow(best.hours) : { from: 0, count: 0 };
  if (window.count <= 0) return t("insBusiestOnly", `${best.name} was the busiest day.`, best.name);
  const from = hourLabel(window.from);
  const to = hourLabel(window.from + 4);
  return t("insBusiestLine", `${best.name}, mostly between ${from} and ${to}.`, [best.name, from, to]);
}
