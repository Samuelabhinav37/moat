import browser from "webextension-polyfill";
import type { GetLogEntriesMessage, LogEntriesResponse } from "../types";
import { LIVE_DYNAMIC_RULE_ID_START, MAX_LIVE_DYNAMIC_RULES } from "../background/liveRedirectRules";

async function getLogEntries(): Promise<LogEntriesResponse> {
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

/** Real, not fabricated: the span the current ring buffer actually covers, oldest entry to
 * now -- not a hardcoded "last 60s" the way the design mock's sample data shows it. */
function formatSince(oldestTimestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - oldestTimestamp) / 1000));
  if (seconds < 60) return `last ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `last ${minutes}m`;
  return `last ${Math.round(minutes / 60)}h`;
}

async function render(): Promise<void> {
  const response = await getLogEntries();

  document.getElementById("host")!.textContent = response.hostname;

  const unsupported = document.getElementById("unsupported")!;
  const empty = document.getElementById("empty")!;
  const table = document.getElementById("table")!;
  const matchSummary = document.getElementById("match-summary")!;
  const footerNote = document.getElementById("footer-note")!;

  unsupported.hidden = response.supported;
  if (!response.supported) {
    empty.hidden = true;
    table.hidden = true;
    matchSummary.hidden = true;
    footerNote.hidden = true;
    return;
  }

  const hasEntries = response.entries.length > 0;
  empty.hidden = hasEntries;
  table.hidden = !hasEntries;
  footerNote.hidden = !hasEntries;

  if (hasEntries) {
    const oldest = Math.min(...response.entries.map((entry) => entry.timestamp));
    matchSummary.hidden = false;
    matchSummary.textContent = `${response.entries.length} matches · ${formatSince(oldest)}`;
  } else {
    matchSummary.hidden = true;
  }

  const rows = document.getElementById("rows")!;
  rows.replaceChildren(
    ...response.entries
      .slice()
      .reverse()
      .map((entry) => {
        const row = document.createElement("div");
        row.className = "grid-row";

        const timeCell = document.createElement("span");
        timeCell.className = "grid-cell";
        timeCell.textContent = formatTime(entry.timestamp);

        const rulesetCell = document.createElement("span");
        rulesetCell.className = "grid-cell";
        const chip = document.createElement("span");
        chip.className = isLiveRule(entry.ruleId) ? "ruleset-chip live" : "ruleset-chip";
        chip.textContent = isLiveRule(entry.ruleId) ? "live" : entry.rulesetId;
        rulesetCell.append(chip);

        const ruleIdCell = document.createElement("span");
        ruleIdCell.className = "grid-cell rule-id";
        ruleIdCell.textContent = String(entry.ruleId);

        const typeCell = document.createElement("span");
        typeCell.className = "grid-cell";
        typeCell.textContent = entry.type;

        const urlCell = document.createElement("span");
        urlCell.className = "grid-cell";
        urlCell.textContent = entry.url;
        urlCell.title = entry.url;

        row.append(timeCell, rulesetCell, ruleIdCell, typeCell, urlCell);
        return row;
      })
  );
}

document.getElementById("refresh")!.addEventListener("click", () => void render());

void render();
