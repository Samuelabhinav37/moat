// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTokens, startSurveyor, tokensOfElement } from "./cosmeticSurveyor";
import { type CosmeticIndex } from "./cosmeticSelectors";
import { tokenHash } from "../shared/tokenHash";

const idx = (partial: Partial<CosmeticIndex>): CosmeticIndex => ({
  genericByHash: {},
  genericHigh: [],
  perDomain: {},
  exceptions: {},
  ...partial,
});

/** Let the MutationObserver microtask and the 0ms flush timer run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("tokensOfElement", () => {
  it("returns the id and every class", () => {
    const el = document.createElement("div");
    el.id = "main";
    el.className = "ad promoted big";
    expect(tokensOfElement(el).sort()).toEqual(["ad", "big", "main", "promoted"]);
  });

  it("returns nothing for an element with no class or id", () => {
    expect(tokensOfElement(document.createElement("span"))).toEqual([]);
  });
});

describe("collectTokens", () => {
  it("gathers tokens from the root and its descendants that carry a class or id", () => {
    const root = document.createElement("section");
    root.className = "wrap";
    root.innerHTML = '<div class="a"></div><p>text</p><span id="b"><i class="c"></i></span>';
    expect(collectTokens(root).sort()).toEqual(["a", "b", "c", "wrap"]);
  });
});

describe("startSurveyor", () => {
  it("emits the token-anchored selectors for tokens already in the DOM at start", async () => {
    document.body.innerHTML = '<div class="ad-slot"></div>';
    const onNew = vi.fn();
    startSurveyor(
      document,
      idx({ genericByHash: { [tokenHash("ad-slot")]: [".ad-slot"] } }),
      "example.com",
      [],
      onNew,
      { flushDelayMs: 0 }
    );
    expect(onNew).toHaveBeenCalledWith([".ad-slot"]);
  });

  it("emits selectors when a matching token appears via a later mutation", async () => {
    const onNew = vi.fn();
    startSurveyor(
      document,
      idx({ genericByHash: { [tokenHash("promo-card")]: [".promo-card"] } }),
      "example.com",
      [],
      onNew,
      { flushDelayMs: 0 }
    );
    expect(onNew).not.toHaveBeenCalled();

    const el = document.createElement("div");
    el.className = "promo-card";
    document.body.append(el);
    await settle();

    expect(onNew).toHaveBeenCalledWith([".promo-card"]);
  });

  it("never re-emits a selector already injected up front", async () => {
    document.body.innerHTML = '<div class="ad"></div>';
    const onNew = vi.fn();
    startSurveyor(
      document,
      idx({ genericByHash: { [tokenHash("ad")]: [".ad", ".ad-wrap"] } }),
      "example.com",
      [".ad"],
      onNew,
      { flushDelayMs: 0 }
    );
    expect(onNew).toHaveBeenCalledWith([".ad-wrap"]);
  });

  it("applies this domain's exceptions to surveyed selectors", async () => {
    document.body.innerHTML = '<div class="ad"></div>';
    const onNew = vi.fn();
    startSurveyor(
      document,
      idx({
        genericByHash: { [tokenHash("ad")]: [".ad", ".ad-wrap"] },
        exceptions: { "example.com": [".ad-wrap"] },
      }),
      "example.com",
      [],
      onNew,
      { flushDelayMs: 0 }
    );
    expect(onNew).toHaveBeenCalledWith([".ad"]);
  });

  it("stop() disconnects: no further emissions after a later mutation", async () => {
    const onNew = vi.fn();
    const handle = startSurveyor(
      document,
      idx({ genericByHash: { [tokenHash("late")]: [".late"] } }),
      "example.com",
      [],
      onNew,
      { flushDelayMs: 0 }
    );
    handle.stop();

    const el = document.createElement("div");
    el.className = "late";
    document.body.append(el);
    await settle();

    expect(onNew).not.toHaveBeenCalled();
  });

  it("self-disables after enough consecutive flushes find nothing new", async () => {
    const onNew = vi.fn();
    startSurveyor(
      document,
      idx({ genericByHash: { [tokenHash("wanted")]: [".wanted"] } }),
      "example.com",
      [],
      onNew,
      { flushDelayMs: 0 }
    );

    // 8 quiet flushes (mutations that carry no matching token) trip the stop.
    for (let i = 0; i < 9; i += 1) {
      const el = document.createElement("div");
      el.className = `noise-${i}`;
      document.body.append(el);
      await settle();
    }

    const el = document.createElement("div");
    el.className = "wanted";
    document.body.append(el);
    await settle();

    expect(onNew).not.toHaveBeenCalled();
  });
});
