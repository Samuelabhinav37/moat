// The popup's count is refreshed more than once per page now (on load, a few
// seconds later, and when the popup opens), but the weekly usage stats and
// Athena's security events add up whatever they're given. These work out
// what a refresh found that an earlier refresh of the same page hasn't
// already recorded.

export interface Recorded {
  total: number;
  counts: Record<string, number>;
}

export const NOTHING_RECORDED: Recorded = { total: 0, counts: {} };

/** New blocks since `recorded`, and what to remember afterwards. Counts only
 * grow within one page, so anything below what was recorded is ignored. */
export function unrecorded(
  recorded: Recorded,
  total: number,
  counts: Record<string, number>
): { total: number; counts: Record<string, number>; next: Recorded } {
  const newCounts: Record<string, number> = {};
  const nextCounts = { ...recorded.counts };
  for (const [key, count] of Object.entries(counts)) {
    const before = recorded.counts[key] ?? 0;
    if (count > before) {
      newCounts[key] = count - before;
      nextCounts[key] = count;
    }
  }
  return {
    total: Math.max(0, total - recorded.total),
    counts: newCounts,
    next: { total: Math.max(recorded.total, total), counts: nextCounts },
  };
}
