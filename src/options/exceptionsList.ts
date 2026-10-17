// Exceptions: one list of the sites where Moat acts differently, each site
// once, the way Safari lists its per-website settings. Each row has one
// pop-up button for what Moat does there (Protected, Paused, Always block,
// Never block), and a line for anything else set on that site: parts of the
// page hidden, or settings changed from Moat's icon, each with its one fix.
// The data comes from Settings (exceptionSites); options.ts does the work.
import type { Settings } from "../types";
import { siteName } from "../shared/siteName";
import { buildPopButton, type PopChoice } from "./popMenu";

export type SiteState = "protected" | "paused" | "block" | "allow";

export interface ExceptionSite {
  hostname: string;
  state: SiteState;
  /** "47 minutes left" for a timed pause. */
  note: string | null;
  hidden: number;
  grayed: number;
  /** Settings changed for this site from Moat's icon. */
  changed: number;
}

/** Every site with something set, sorted by name. A site counts once even
 * when it is paused and also has parts hidden. */
export function exceptionSites(settings: Settings, note: (hostname: string) => string | null): ExceptionSite[] {
  const sites = new Map<string, ExceptionSite>();
  const site = (hostname: string) => {
    let entry = sites.get(hostname);
    if (!entry) {
      entry = { hostname, state: "protected", note: null, hidden: 0, grayed: 0, changed: 0 };
      sites.set(hostname, entry);
    }
    return entry;
  };
  for (const h of settings.customAllowedDomains) site(h).state = "allow";
  for (const h of settings.customBlockedDomains) site(h).state = "block";
  for (const h of settings.disabledSites) {
    const entry = site(h);
    entry.state = "paused";
    entry.note = note(h);
  }
  for (const [h, rules] of Object.entries(settings.customCosmeticRules)) if (rules.length) site(h).hidden = rules.length;
  for (const [h, rules] of Object.entries(settings.customGrayscaleRules)) if (rules.length) site(h).grayed = rules.length;
  for (const [h, values] of Object.entries(settings.perSiteOverrides ?? {})) {
    const count = Object.values(values ?? {}).filter((v) => typeof v === "boolean").length;
    if (count) site(h).changed = count;
  }
  const bare = (h: string) => h.replace(/^www\./i, "");
  return [...sites.values()].sort((a, b) => siteName(a.hostname).localeCompare(siteName(b.hostname)) || bare(a.hostname).localeCompare(bare(b.hostname)));
}

export type ExceptionFilter = "all" | "paused" | "hidden" | "block" | "allow";

export function matchesFilter(site: ExceptionSite, filter: ExceptionFilter): boolean {
  if (filter === "all") return true;
  if (filter === "hidden") return site.hidden + site.grayed + site.changed > 0;
  return site.state === filter;
}

export interface ExceptionLabels {
  menuLabel: (name: string) => string;
  states: Record<SiteState, { label: string; desc: string }>;
  hidden: (count: number) => string;
  grayed: (count: number) => string;
  changed: (count: number) => string;
  showAgain: string;
  reset: string;
}

export interface ExceptionHandlers {
  /** `anchor` is the pop-up button, for a follow-up menu (how long to pause). */
  setState: (site: ExceptionSite, state: SiteState, anchor: HTMLElement) => void;
  showAgain: (site: ExceptionSite) => void;
  reset: (site: ExceptionSite) => void;
}

export function buildExceptionRow(
  doc: Document,
  site: ExceptionSite,
  labels: ExceptionLabels,
  handlers: ExceptionHandlers,
  icon: (hostname: string) => HTMLElement,
  /** Show the address under the name, where two rows would read the same. */
  withAddress: boolean
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "ex-row";
  row.dataset.host = site.hostname;
  row.dataset.state = site.state;
  const bare = site.hostname.replace(/^www\./i, "");
  const name = siteName(site.hostname);
  row.dataset.search = `${name} ${bare}`;
  row.title = bare;

  const text = doc.createElement("div");
  text.className = "ex-text";
  text.append(Object.assign(doc.createElement("b"), { className: "ex-name", textContent: name }));
  const lines: HTMLElement[] = [];
  if (withAddress) lines.push(Object.assign(doc.createElement("span"), { textContent: bare }));
  if (site.note) lines.push(Object.assign(doc.createElement("span"), { textContent: site.note }));
  const action = (what: string, label: string, run: () => void) => {
    const line = doc.createElement("span");
    const button = Object.assign(doc.createElement("button"), { type: "button", className: "ex-link", textContent: label });
    button.setAttribute("aria-label", `${label}: ${what}, ${name}`);
    button.addEventListener("click", run);
    line.append(doc.createTextNode(`${what} · `), button);
    return line;
  };
  if (site.hidden) lines.push(action(labels.hidden(site.hidden), labels.showAgain, () => handlers.showAgain(site)));
  if (site.grayed) lines.push(action(labels.grayed(site.grayed), labels.showAgain, () => handlers.showAgain(site)));
  if (site.changed) lines.push(action(labels.changed(site.changed), labels.reset, () => handlers.reset(site)));
  if (lines.length) {
    const sub = doc.createElement("span");
    sub.className = "ex-sub";
    sub.append(...lines);
    text.append(sub);
  }

  const choices = (): PopChoice<SiteState>[] =>
    (["protected", "paused", "block", "allow"] as const).map((value) => ({ value, label: labels.states[value].label, desc: labels.states[value].desc }));
  const pop = buildPopButton<SiteState>(
    doc,
    labels.menuLabel(name),
    () => ({ value: site.state, text: labels.states[site.state].label }),
    choices,
    (state) => handlers.setState(site, state, pop.querySelector("button")!),
    "pop-btn pop-btn-sm"
  );
  row.append(icon(site.hostname), text, pop);
  return row;
}

/** Names that two or more rows share ("Fandom" for fandom.com and
 * jack-reacher.fandom.com), so those rows show their address too. */
export function sharedNames(sites: readonly ExceptionSite[]): Set<string> {
  const seen = new Map<string, number>();
  for (const s of sites) seen.set(siteName(s.hostname), (seen.get(siteName(s.hostname)) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
}
