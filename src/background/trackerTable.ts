// Loads rules/tracker-domains.json once per worker (shared/trackerDomains.ts
// says how it's used). Until it arrives, callers get null and fall back to
// the rule-based split, so a cold worker never blocks on it.
import browser from "webextension-polyfill";
import type { TrackerTable } from "../shared/trackerDomains";

let table: TrackerTable | null = null;
let loading: Promise<TrackerTable | null> | null = null;

export function loadTrackerTable(): Promise<TrackerTable | null> {
  if (table) return Promise.resolve(table);
  loading ??= fetch(browser.runtime.getURL("rules/tracker-domains.json"))
    .then((response) => response.json() as Promise<TrackerTable>)
    .then((loaded) => (table = loaded))
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

/** The table if it has loaded, else null (and starts loading it). */
export function trackerTableNow(): TrackerTable | null {
  if (!table) void loadTrackerTable();
  return table;
}
