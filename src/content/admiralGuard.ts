// Runs in the page's MAIN world at document_start, before any page script.
// Registered by background/optionalContentScripts.ts, which leaves out
// paused sites, so a paused site gets no part of this.
//
// Admiral is an ad-blocker detector and "ad recovery" service. A site starts
// it with an inline bootstrap that creates window.admiral and then loads
// everything else from domains that change often (on weather.com in
// 2026-09: axonsite.com, hyperfrost.net, bighornbasin.net). It sends bait
// requests, and when a blocker stops one it covers the page with "Looks
// like you're using an ad blocker". Moat blocked two of weather.com's baits,
// so every second or so visit showed the wall, while ~650 requests of
// recovered ads loaded underneath.
//
// Making the first write to window.admiral throw stops the bootstrap on its
// first line, so none of Admiral loads: no baits, no recovered ads, no wall.
// uBlock Origin does the same (abort-on-property-write). A page that never
// uses Admiral never touches the property.
try {
  Object.defineProperty(window, "admiral", {
    configurable: false,
    get: () => undefined,
    set: () => {
      throw new ReferenceError("admiral");
    },
  });
} catch {
  // Already defined by the page as non-configurable: leave it.
}
