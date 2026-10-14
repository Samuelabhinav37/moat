// Moat's own rules, not from AdGuard: requests a page retries in a tight
// loop when they're blocked outright. Answering them with an empty stand-in
// (the same bundled redirect resources AdGuard's $redirect rules use) gives
// the script a valid, empty reply, so it stops asking. Each entry was found
// by measuring a real page, and says so.
//
// Priority 1001 matches AdGuard's own $redirect rules: above the plain block
// rules they replace (priority 1-2), still inside the bundled ad band, so
// pausing a site or "Never block" still wins (src/shared/rulePriorities.ts).
export const RETRY_LOOP_STUBS = [
  {
    // cnn.com, 26 Sep 2026: with the request blocked, CNN's video player
    // (boltPlayer) re-requested this ad-config file ~280 times a second,
    // 5,673 times in 20 seconds on one page load.
    urlFilter: "||cdn-media.brightline.tv/config/",
    resourceTypes: ["xmlhttprequest"],
    // A fetch()/XHR stand-in shows the page Moat's own address (see
    // fetchableRedirects.mjs), so it only answers the site it was measured
    // on. Anywhere else the request is blocked like any other.
    initiatorDomains: ["cnn.com"],
    resource: "noopjson.json",
  },
  // Field probe, 14 Oct 2026 (.cache/opt/field/retry-probe.mjs, 30 s per
  // page with Moat on): sites' own telemetry retried when blocked. Each
  // stand-in was checked to cut the requests, not just answer them; Spotify's
  // and Stripe's events weren't retries (same count answered), so they stay
  // blocked.
  {
    // doordash.com: 66 tries in 8 s.
    urlFilter: "||doordash.com/iguazu-edge/",
    resourceTypes: ["xmlhttprequest"],
    initiatorDomains: ["doordash.com"],
    resource: "noopjson.json",
  },
  {
    // linkedin.com: 32 tries in 28 s.
    urlFilter: "||www.linkedin.com/li/track",
    resourceTypes: ["xmlhttprequest"],
    initiatorDomains: ["linkedin.com"],
    resource: "noopjson.json",
  },
  {
    // notion.com: 12 tries in 14 s (Statsig). ChatGPT uses Statsig the same
    // way; the field report's 1,136 blocks a day were these and ces below.
    urlFilter: "||exp.notion.com/v1/rgstr",
    resourceTypes: ["xmlhttprequest"],
    initiatorDomains: ["notion.com", "notion.so"],
    resource: "noopjson.json",
  },
  {
    urlFilter: "||ab.chatgpt.com/v1/rgstr",
    resourceTypes: ["xmlhttprequest"],
    initiatorDomains: ["chatgpt.com"],
    resource: "noopjson.json",
  },
  {
    urlFilter: "||chatgpt.com/ces/",
    resourceTypes: ["xmlhttprequest"],
    initiatorDomains: ["chatgpt.com"],
    resource: "noopjson.json",
  },
  {
    // weather.com: 9 tries in 26 s (Amplitude experiments).
    urlFilter: "||api.lab.amplitude.com/sdk/v2/vardata",
    resourceTypes: ["xmlhttprequest"],
    initiatorDomains: ["weather.com"],
    resource: "noopjson.json",
  },
];

export const RETRY_LOOP_STUB_PRIORITY = 1001;

export function buildRetryLoopStubRules(stubs = RETRY_LOOP_STUBS) {
  return stubs.map((stub, i) => ({
    id: i + 1,
    priority: RETRY_LOOP_STUB_PRIORITY,
    action: { type: "redirect", redirect: { extensionPath: `/web-accessible-resources/redirects/${stub.resource}` } },
    condition: { urlFilter: stub.urlFilter, resourceTypes: stub.resourceTypes, initiatorDomains: stub.initiatorDomains },
  }));
}

/** True for one of the rules above, exactly as built: the only stand-ins
 * allowed to answer fetch()/XHR, each limited to its measured site. */
export function isRetryLoopStubRule(rule, stubs = RETRY_LOOP_STUBS) {
  const c = rule.condition ?? {};
  return stubs.some(
    (stub) =>
      rule.action?.redirect?.extensionPath === `/web-accessible-resources/redirects/${stub.resource}` &&
      c.urlFilter === stub.urlFilter &&
      JSON.stringify(c.initiatorDomains) === JSON.stringify(stub.initiatorDomains)
  );
}

/** The redirect resource files these rules need shipped. */
export function retryLoopStubResources(stubs = RETRY_LOOP_STUBS) {
  return [...new Set(stubs.map((stub) => stub.resource))];
}
