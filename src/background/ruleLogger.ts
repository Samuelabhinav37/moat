// Diagnostic tool, not a user feature: chrome.declarativeNetRequest.onRuleMatchedDebug
// fires per-match with the actual request URL and which rule matched it --
// but per Chrome's own docs this event only exists for extensions loaded
// unpacked (developer mode), never a Chrome Web Store install. Scoped
// deliberately narrow: this exists to diagnose Moat's own fragile
// heuristics (the YouTube ad dimmer, the feed scanner) when they break
// silently after a site markup change, not to be a general end-user
// feature -- see src/logger/.
import type { LoggedMatch } from "../types";

const MAX_ENTRIES_PER_TAB = 200;

/** A true fixed-capacity ring buffer -- push is O(1) (write to a slot,
 * advance an index), unlike an array + shift() which is O(n) once full
 * (shift re-indexes every remaining element). Pulled out as its own class,
 * pure and testable without the chrome.declarativeNetRequest API this file
 * otherwise depends on, since push() is called on every matched request
 * (potentially many per page) while toArray() is only called when the
 * diagnostic logger page is actually open -- worth moving the O(n) cost to
 * the rare read instead of the frequent write. */
export class RingBuffer<T> {
  private readonly slots: (T | undefined)[];
  private writeIndex = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.slots = new Array(capacity);
  }

  push(item: T): void {
    this.slots[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** Oldest-to-newest snapshot. O(count), not O(1) -- only worth calling
   * when something actually needs to read the buffer, not on every push. */
  toArray(): T[] {
    if (this.count < this.capacity) return this.slots.slice(0, this.count) as T[];
    return [...this.slots.slice(this.writeIndex), ...this.slots.slice(0, this.writeIndex)] as T[];
  }
}

const entriesByTab = new Map<number, RingBuffer<LoggedMatch>>();

export function isSupported(): boolean {
  return typeof chrome !== "undefined" && !!chrome.declarativeNetRequest?.onRuleMatchedDebug;
}

export function getEntries(tabId: number): LoggedMatch[] {
  return entriesByTab.get(tabId)?.toArray() ?? [];
}

export function forgetTab(tabId: number): void {
  entriesByTab.delete(tabId);
}

export function initRuleLogger(): void {
  if (!isSupported()) return;

  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const { tabId } = info.request;
    if (tabId < 0) return; // not associated with any tab (e.g. a background fetch)

    let buffer = entriesByTab.get(tabId);
    if (!buffer) {
      buffer = new RingBuffer<LoggedMatch>(MAX_ENTRIES_PER_TAB);
      entriesByTab.set(tabId, buffer);
    }
    buffer.push({
      timestamp: Date.now(),
      url: info.request.url,
      method: info.request.method,
      type: info.request.type,
      ruleId: info.rule.ruleId,
      rulesetId: info.rule.rulesetId,
    });
  });
}
