// GA4 Measurement Protocol and legacy Universal Analytics collect-endpoint
// signatures. Extracted so the regex patterns are independently testable
// (update-filters.mjs itself has no test coverage for the inline rule
// builders it already had -- this is the first one worth pulling out).
//
// Server-side/proxied Google Analytics increasingly gets routed through a
// site's own first-party domain via a direct A/AAAA record (no CNAME at
// all), specifically to defeat CNAME-based ad blockers -- SST-Guard
// (arXiv:2604.27497, 2026) measured this on ~4.2% of the Tranco top 150k,
// which slips straight past background/cnameUncloak.ts since there's
// nothing to uncloak. GA's own wire format stays fingerprintable regardless
// of which domain it's proxied through: GA4's Measurement Protocol always
// posts to a path containing "/g/collect" with a "tid=G-..." param; legacy
// Universal Analytics (still seen on older proxied setups) posts to
// "/collect" with "tid=UA-...". A URL's path always precedes its query
// string, so requiring the tid= prefix to appear anywhere after the path
// segment needs no lookahead (DNR's RE2 engine doesn't support one anyway)
// -- both prefixes are GA-specific enough on their own that this doesn't
// also need to pin down v=1/v=2's exact position.
export const GA4_COLLECT_REGEX = "/g/collect\\?[^#]*[?&]tid=G-";
export const UA_COLLECT_REGEX = "/collect\\?[^#]*[?&]tid=UA-";

export function regexTrackerBlockRule(id, regexFilter) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter,
      // Deliberately excludes main_frame/sub_frame: a collect beacon is
      // never a frame navigation.
      resourceTypes: ["xmlhttprequest", "ping", "image", "other"],
    },
  };
}

export function buildServerSideAnalyticsRules() {
  return [regexTrackerBlockRule(1, GA4_COLLECT_REGEX), regexTrackerBlockRule(2, UA_COLLECT_REGEX)];
}
