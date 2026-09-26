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
    resource: "noopjson.json",
  },
];

export const RETRY_LOOP_STUB_PRIORITY = 1001;

export function buildRetryLoopStubRules(stubs = RETRY_LOOP_STUBS) {
  return stubs.map((stub, i) => ({
    id: i + 1,
    priority: RETRY_LOOP_STUB_PRIORITY,
    action: { type: "redirect", redirect: { extensionPath: `/web-accessible-resources/redirects/${stub.resource}` } },
    condition: { urlFilter: stub.urlFilter, resourceTypes: stub.resourceTypes },
  }));
}

/** The redirect resource files these rules need shipped. */
export function retryLoopStubResources(stubs = RETRY_LOOP_STUBS) {
  return [...new Set(stubs.map((stub) => stub.resource))];
}
