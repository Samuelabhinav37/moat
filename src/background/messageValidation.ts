// Pure boundary-validation helpers for background/index.ts's message
// listener, pulled out so they're directly unit-testable -- index.ts itself
// imports webextension-polyfill at module scope and is the single highest-
// traffic file in the extension (every settings change, element-pick, and
// content-script report passes through its one onMessage listener), but has
// no test file of its own; unlike most of background/'s other untested
// files (thin wiring delegating to an already-tested pure module), this one
// used to keep its own real validation logic inline and untested. Same
// convention as settingsPortability.ts/filterListImport.ts's untrusted-
// boundary helpers: a message payload is untrusted regardless of which of
// Moat's own code sent it, so every field gets checked here rather than
// trusted because "only elementPicker.ts sends this today."

// hostname/selector arrive from a sender the TS types trust unconditionally
// (only Moat's own elementPicker.ts sends these today), but the listener
// itself shouldn't -- a compact, independent check at this boundary so it
// stays safe against any future sender, not just the current one.
export const MAX_MESSAGE_STRING_LENGTH = 2000;
// Deliberately smaller than the general cap above: this is the one message
// carrying free text a user typed, headed to an org's Athena instance --
// capped independently rather than just reusing the general limit.
export const MAX_OVERRIDE_REASON_LENGTH = 500;

export function isValidMessageString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_MESSAGE_STRING_LENGTH;
}

// Same shape check on both of record-custom-rule-match's arrays -- capped
// independently of MAX_MESSAGE_STRING_LENGTH's per-string bound since this
// bounds the array itself (a hostname's own picker rules are never anywhere
// near this many).
export const MAX_RULE_MATCH_HITS = 200;

export function isHostnameSelectorHits(value: unknown): value is Array<{ hostname: string; selector: string }> {
  return (
    Array.isArray(value) &&
    value.length <= MAX_RULE_MATCH_HITS &&
    value.every(
      (item): item is { hostname: string; selector: string } =>
        typeof item === "object" &&
        item !== null &&
        isValidMessageString((item as Record<string, unknown>).hostname) &&
        isValidMessageString((item as Record<string, unknown>).selector)
    )
  );
}

// record-usage-signal's own count bound: a content script reports how many
// times a heuristic fired in one batch (e.g. searchSlopFilter hiding several
// results at once) -- 1000 is far more than any real single-page-load batch,
// so this only ever clamps a malformed/hostile count, never a real one.
// Falls back to 1 (not 0 or the cap) so a garbage value still counts as "it
// fired," matching what a caller not batching at all would have sent.
export const MAX_USAGE_SIGNAL_COUNT = 1000;

export function clampUsageSignalCount(value: unknown): number {
  return typeof value === "number" && value > 0 && value <= MAX_USAGE_SIGNAL_COUNT ? value : 1;
}
