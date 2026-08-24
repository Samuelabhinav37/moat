import browser from "webextension-polyfill";
import type { GetLogEntriesMessage, LogEntriesResponse } from "../types";

async function getLogEntries(): Promise<LogEntriesResponse> {
  const message: GetLogEntriesMessage = { type: "get-log-entries" };
  return browser.runtime.sendMessage(message) as Promise<LogEntriesResponse>;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

async function render(): Promise<void> {
  const response = await getLogEntries();

  document.getElementById("host")!.textContent = response.hostname;

  const unsupported = document.getElementById("unsupported")!;
  const empty = document.getElementById("empty")!;
  const table = document.getElementById("table")!;

  unsupported.hidden = response.supported;
  if (!response.supported) {
    empty.hidden = true;
    table.hidden = true;
    return;
  }

  empty.hidden = response.entries.length > 0;
  table.hidden = response.entries.length === 0;

  const rows = document.getElementById("rows")!;
  rows.replaceChildren(
    ...response.entries
      .slice()
      .reverse()
      .map((entry) => {
        const tr = document.createElement("tr");
        const cells = [
          formatTime(entry.timestamp),
          entry.rulesetId,
          String(entry.ruleId),
          entry.type,
        ];
        for (const text of cells) {
          const td = document.createElement("td");
          td.textContent = text;
          tr.append(td);
        }
        const urlCell = document.createElement("td");
        urlCell.className = "url";
        urlCell.textContent = entry.url;
        urlCell.title = entry.url;
        tr.append(urlCell);
        return tr;
      })
  );
}

document.getElementById("refresh")!.addEventListener("click", () => void render());

void render();
