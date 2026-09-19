import browser from "webextension-polyfill";
import type { DiagnosticsHeuristicRow, GetLogEntriesMessage, LogEntriesResponse } from "../types";
import { LIVE_DYNAMIC_RULE_ID_START, MAX_LIVE_DYNAMIC_RULES } from "../background/liveRedirectRules";
import { HEURISTIC_DEFS } from "../shared/heuristicScope";
import { applyStaticI18n, getMessageOrFallback } from "../shared/i18n";

function tFallback(key: string, fallback: string, substitutions?: string | string[]): string {
  return getMessageOrFallback((k, s) => browser.i18n.getMessage(k, s), key, fallback, substitutions);
}

applyStaticI18n(document, (key, subs) => browser.i18n.getMessage(key, subs));

const SVG_NS = "http://www.w3.org/2000/svg";

async function getDiagnostics(): Promise<LogEntriesResponse> {
  const message: GetLogEntriesMessage = { type: "get-log-entries" };
  return browser.runtime.sendMessage(message) as Promise<LogEntriesResponse>;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

/** Whether this rule id fell within the live-update channel's reserved dynamic-rule range
 * (see liveRedirectRules.ts) -- distinct from the custom block/allow ranges below it. */
function isLiveRule(ruleId: number): boolean {
  return ruleId >= LIVE_DYNAMIC_RULE_ID_START && ruleId < LIVE_DYNAMIC_RULE_ID_START + MAX_LIVE_DYNAMIC_RULES;
}

/** Silent uses a triangle glyph, not a dot -- state must not depend on hue
 * alone, same rule as the stale-rule marker in Custom Rules (see
 * options.ts's buildStaleTriangleIcon, a visually distinct icon for a
 * different meaning). Built via the DOM rather than an innerHTML template --
 * web-ext lint flags any innerHTML assignment it can't statically prove is a
 * literal, even a safe hardcoded one, as UNSAFE_VAR_ASSIGNMENT. */
function buildSilentIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("class", "state-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.7");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("aria-hidden", "true");

  const outline = document.createElementNS(SVG_NS, "path");
  outline.setAttribute("d", "M8 2.5l6 11H2l6-11z");
  const stem = document.createElementNS(SVG_NS, "path");
  stem.setAttribute("d", "M8 6.6v3M8 11.6v.2");

  icon.append(outline, stem);
  return icon;
}

/** Hedged, never a confirmed-error claim -- "silent" is an inference. A feed
 * scanner that hasn't fired may mean the site's markup changed, or may just
 * mean the user hasn't scrolled past a sponsored post yet. */
function silentDetailFor(id: DiagnosticsHeuristicRow["id"]): string {
  switch (id) {
    case "grayscaleAds":
      return tFallback(
        "diagnosticsSilentGrayscale",
        "No ad to dim yet. If that seems wrong, YouTube's player markup may have changed."
      );
    case "feedAdRemoval":
      return tFallback(
        "diagnosticsSilentFeed",
        "Nothing sponsored has shown up in the feed yet. Could also mean the site's markup changed."
      );
    case "cookieBannerReject":
      return tFallback("diagnosticsSilentConsent", "This page probably didn't show a consent banner.");
    case "searchSlop":
      return tFallback("diagnosticsSilentSearchSlop", "None of this search's results matched the filter.");
    case "leakedPasswordCheck":
      return tFallback(
        "diagnosticsSilentLeakedPassword",
        "Only runs once you actually type a password into a field on this page."
      );
    case "fingerprint":
      return tFallback("diagnosticsSilentFingerprint", "Nothing needed randomising on this page load.");
    case "cnameUncloak":
      return tFallback("diagnosticsSilentCname", "This page probably has no disguised trackers to catch.");
  }
}

function buildHeuristicRow(def: (typeof HEURISTIC_DEFS)[number], row: DiagnosticsHeuristicRow): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "heuristic-row";

  const body = document.createElement("div");
  body.className = "h-body";
  const name = document.createElement("div");
  name.textContent = tFallback(...def.titleKey);

  if (!row.on) {
    wrap.append((() => {
      const dot = document.createElement("span");
      dot.className = "state off";
      return dot;
    })());
    name.className = "h-name off";
    const offTag = document.createElement("span");
    offTag.className = "off-tag";
    offTag.textContent = " " + tFallback("diagnosticsOffTag", "— off");
    name.append(offTag);
    body.append(name);
  } else if (row.fired) {
    const dot = document.createElement("span");
    dot.className = "state fired";
    wrap.append(dot);
    name.className = "h-name";
    body.append(name);
    const detail = document.createElement("div");
    detail.className = "h-detail";
    const times = tFallback("diagnosticsFiredTimes", `Fired ${row.fired.count}x this page load`, String(row.fired.count));
    detail.textContent = `${times} · ${tFallback("diagnosticsLastAt", `last at ${formatTime(row.fired.lastFiredAt).split(".")[0]}`, formatTime(row.fired.lastFiredAt))}`;
    body.append(detail);
  } else {
    wrap.append(buildSilentIcon());
    name.className = "h-name";
    body.append(name);
    const detail = document.createElement("div");
    detail.className = "h-detail caution";
    detail.textContent = silentDetailFor(def.id);
    body.append(detail);
  }

  const idEl = document.createElement("span");
  idEl.className = "h-id";
  idEl.textContent = def.id;

  wrap.append(body, idEl);
  return wrap;
}

async function render(): Promise<void> {
  const response = await getDiagnostics();

  document.getElementById("diag-host")!.textContent = response.hostname || "—";

  const rowsContainer = document.getElementById("diag-heuristic-rows")!;
  const scopeNote = document.getElementById("diag-scope-note") as HTMLElement;

  const byId = new Map(response.heuristics.map((row) => [row.id, row]));
  const inScope = HEURISTIC_DEFS.filter((def) => byId.get(def.id)?.appliesHere);
  const outOfScope = HEURISTIC_DEFS.filter((def) => !byId.get(def.id)?.appliesHere);

  rowsContainer.replaceChildren(
    ...inScope.map((def) => buildHeuristicRow(def, byId.get(def.id)!))
  );

  if (outOfScope.length > 0) {
    scopeNote.hidden = false;
    const names = outOfScope.map((def) => tFallback(...def.titleKey)).join(" and ");
    scopeNote.textContent = tFallback(
      "diagnosticsScopeNote",
      `${names} ${outOfScope.length === 1 ? "doesn't" : "don't"} apply to this page and ${outOfScope.length === 1 ? "isn't" : "aren't"} listed.`,
      names
    );
  } else {
    scopeNote.hidden = true;
  }

  const watchable = inScope.map((def) => byId.get(def.id)!).filter((row) => row.on);
  const firedCount = watchable.filter((row) => row.fired !== null).length;
  document.getElementById("diag-fired")!.textContent = String(firedCount);
  document.getElementById("diag-applicable")!.textContent = String(watchable.length);
  document.getElementById("diag-silent")!.textContent = String(watchable.length - firedCount);
  document.getElementById("diag-matches")!.textContent = String(response.entries.length);

  const unavailable = document.getElementById("diag-matches-unavailable") as HTMLElement;
  const table = document.getElementById("diag-matches-table") as HTMLElement;
  const empty = document.getElementById("diag-matches-empty") as HTMLElement;

  unavailable.hidden = response.supported;
  if (!response.supported) {
    table.hidden = true;
    empty.hidden = true;
    return;
  }

  const hasEntries = response.entries.length > 0;
  table.hidden = !hasEntries;
  empty.hidden = hasEntries;

  const body = document.getElementById("diag-matches-body")!;
  body.replaceChildren(
    ...response.entries
      .slice()
      .reverse()
      .map((entry) => {
        const row = document.createElement("tr");

        const timeCell = document.createElement("td");
        timeCell.textContent = formatTime(entry.timestamp);

        const ruleCell = document.createElement("td");
        const chip = document.createElement("span");
        chip.className = isLiveRule(entry.ruleId) ? "ruleset-chip live" : "ruleset-chip";
        chip.textContent = isLiveRule(entry.ruleId) ? "live" : `${entry.rulesetId}:${entry.ruleId}`;
        ruleCell.append(chip);

        const typeCell = document.createElement("td");
        typeCell.textContent = entry.type;

        const urlCell = document.createElement("td");
        urlCell.className = "url";
        urlCell.textContent = entry.url;
        urlCell.title = entry.url;

        row.append(timeCell, ruleCell, typeCell, urlCell);
        return row;
      })
  );
}

document.getElementById("diag-refresh")!.addEventListener("click", () => void render());

void render();
