// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  findAdElements,
  hostOf,
  isAdNetworkHost,
  runAdCollapsePass,
  shouldCollapseAncestor,
} from "./adCollapse";

const NETWORKS = new Set(["doubleclick.net", "googlesyndication.com", "criteo.com"]);

// jsdom's getBoundingClientRect/getComputedStyle aren't representative, so
// every geometry-dependent test passes an explicit fake. `height` feeds
// heightOf(); `rect` (when given) is what shouldCollapseAncestor reads for
// the standard-ad-size fallback -- we stub getBoundingClientRect on the
// element for that path.
const geom = (opts: { height?: number; rendered?: (el: Element) => boolean }) => ({
  heightOf: (_el: Element) => opts.height ?? 0,
  isRendered: opts.rendered ?? (() => false),
});

const withRect = (el: Element, width: number, height: number): Element => {
  (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return el;
};

afterEach(() => {
  document.body.innerHTML = "";
  document.getElementById("moat-ad-collapse")?.remove();
});

describe("hostOf", () => {
  it("returns the lowercased host of an absolute URL", () => {
    expect(hostOf("https://AD.DoubleClick.net/gampad/ads?x=1")).toBe("ad.doubleclick.net");
  });
  it("returns '' for a relative or unparseable src", () => {
    expect(hostOf("/local/ad.png")).toBe("");
    expect(hostOf("not a url")).toBe("");
  });
});

describe("isAdNetworkHost", () => {
  it("matches an exact domain and any subdomain", () => {
    expect(isAdNetworkHost("doubleclick.net", NETWORKS)).toBe(true);
    expect(isAdNetworkHost("securepubads.g.doubleclick.net", NETWORKS)).toBe(true);
  });
  it("does not match an unrelated or empty host", () => {
    expect(isAdNetworkHost("example.com", NETWORKS)).toBe(false);
    expect(isAdNetworkHost("", NETWORKS)).toBe(false);
  });
  it("does not match a look-alike parent (notdoubleclick.net)", () => {
    expect(isAdNetworkHost("notdoubleclick.net", NETWORKS)).toBe(false);
  });
});

describe("findAdElements", () => {
  it("finds iframe/img whose src host is an ad network", () => {
    document.body.innerHTML = `
      <iframe src="https://ad.doubleclick.net/x"></iframe>
      <img src="https://static.criteo.com/pix.gif">
      <iframe src="https://example.com/embed"></iframe>
      <img src="/logo.png">`;
    const found = findAdElements(document, NETWORKS);
    expect(found.map((e) => e.tagName)).toEqual(["IFRAME", "IMG"]);
  });

  it("finds an unfilled ins.adsbygoogle but not a filled one", () => {
    document.body.innerHTML = `
      <ins class="adsbygoogle"></ins>
      <ins class="adsbygoogle" data-ad-status="filled"></ins>
      <ins class="adsbygoogle"><iframe></iframe></ins>`;
    expect(findAdElements(document, NETWORKS)).toHaveLength(1);
  });

  it("skips an element already handled in a previous pass", () => {
    document.body.innerHTML = `<iframe src="https://ad.doubleclick.net/x" data-moat-ad-collapsed></iframe>`;
    expect(findAdElements(document, NETWORKS)).toHaveLength(0);
  });
});

describe("shouldCollapseAncestor", () => {
  const mk = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as Element;
  };

  it("collapses a wrapper holding only the ad chain and reserving height", () => {
    const wrap = mk(`<div><iframe></iframe><script></script></div>`);
    const ad = wrap.querySelector("iframe")!;
    expect(shouldCollapseAncestor(wrap, new Set([ad]), geom({ height: 250 }))).toBe(true);
  });

  it("leaves a wrapper that has other rendered content", () => {
    const wrap = mk(`<div><iframe></iframe><p>real text</p></div>`);
    const ad = wrap.querySelector("iframe")!;
    const p = wrap.querySelector("p")!;
    expect(shouldCollapseAncestor(wrap, new Set([ad]), geom({ height: 250, rendered: (el) => el === p }))).toBe(false);
  });

  it("never collapses body / main / a landmark role", () => {
    const main = mk(`<main><iframe></iframe></main>`);
    expect(shouldCollapseAncestor(main, new Set([main.querySelector("iframe")!]), geom({ height: 250 }))).toBe(false);
    const banner = mk(`<div role="banner"><iframe></iframe></div>`);
    expect(shouldCollapseAncestor(banner, new Set([banner.querySelector("iframe")!]), geom({ height: 250 }))).toBe(false);
  });

  it("collapses a zero-height wrapper only if its box is a standard ad size", () => {
    const wrap = mk(`<div><iframe></iframe></div>`);
    const ad = wrap.querySelector("iframe")!;
    withRect(wrap, 300, 250);
    expect(shouldCollapseAncestor(wrap, new Set([ad]), geom({ height: 0 }))).toBe(true);
    withRect(wrap, 301, 7);
    expect(shouldCollapseAncestor(wrap, new Set([ad]), geom({ height: 0 }))).toBe(false);
  });
});

describe("runAdCollapsePass", () => {
  it("hides the ad element, collapses its wrapper, adds the style once, is idempotent", () => {
    document.body.innerHTML = `<main><div class="slot"><iframe src="https://ad.doubleclick.net/x"></iframe></div></main>`;
    const g = geom({ height: 250 });

    const n1 = runAdCollapsePass(document, NETWORKS, g);
    expect(n1).toBe(1);
    const iframe = document.querySelector("iframe")!;
    const slot = document.querySelector(".slot")!;
    expect(iframe.hasAttribute("data-moat-ad-collapsed")).toBe(true);
    expect(slot.hasAttribute("data-moat-ad-collapsed")).toBe(true);
    expect(document.querySelectorAll("#moat-ad-collapse")).toHaveLength(1);

    const n2 = runAdCollapsePass(document, NETWORKS, g);
    expect(n2).toBe(0);
    expect(document.querySelectorAll("#moat-ad-collapse")).toHaveLength(1);
  });

  it("does nothing when there are no ad elements", () => {
    document.body.innerHTML = `<div><iframe src="https://example.com/x"></iframe></div>`;
    expect(runAdCollapsePass(document, NETWORKS, geom({ height: 250 }))).toBe(0);
    expect(document.getElementById("moat-ad-collapse")).toBeNull();
  });
});
