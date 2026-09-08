// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTokens, startSurveyor, tokensOfElement, type ResolveHashes } from "./cosmeticSurveyor";
import { tokenHash } from "../shared/tokenHash";

/** Let the MutationObserver microtask, the 0ms flush timer, and the async
 * resolveHashes round-trip all run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Fake of the service-worker get-cosmetic-generics lookup: a
 * genericByHash-style map, plus selectors this host excepts. */
const resolver =
  (byHash: Record<string, string[]>, excluded: string[] = []): ResolveHashes =>
  async (hashes) => {
    const out = new Set<string>();
    for (const hash of hashes) {
      for (const selector of byHash[hash] ?? []) {
        if (!excluded.includes(selector)) out.add(selector);
      }
    }
    return [...out];
  };

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
    startSurveyor(document, [], resolver({ [tokenHash("ad-slot")]: [".ad-slot"] }), onNew, { flushDelayMs: 0 });
    await settle();
    expect(onNew).toHaveBeenCalledWith([".ad-slot"]);
  });

  it("emits selectors when a matching token appears via a later mutation", async () => {
    const onNew = vi.fn();
    startSurveyor(document, [], resolver({ [tokenHash("promo-card")]: [".promo-card"] }), onNew, { flushDelayMs: 0 });
    await settle();
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
    startSurveyor(document, [".ad"], resolver({ [tokenHash("ad")]: [".ad", ".ad-wrap"] }), onNew, { flushDelayMs: 0 });
    await settle();
    expect(onNew).toHaveBeenCalledWith([".ad-wrap"]);
  });

  it("respects the exceptions the resolver applies for this domain", async () => {
    document.body.innerHTML = '<div class="ad"></div>';
    const onNew = vi.fn();
    startSurveyor(
      document,
      [],
      resolver({ [tokenHash("ad")]: [".ad", ".ad-wrap"] }, [".ad-wrap"]),
      onNew,
      { flushDelayMs: 0 }
    );
    await settle();
    expect(onNew).toHaveBeenCalledWith([".ad"]);
  });

  it("keeps only one resolveHashes call in flight at a time", async () => {
    let active = 0;
    let maxActive = 0;
    const slow: ResolveHashes = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return [];
    };
    startSurveyor(document, [], slow, vi.fn(), { flushDelayMs: 0 });
    for (let i = 0; i < 4; i += 1) {
      const el = document.createElement("div");
      el.className = `t-${i}`;
      document.body.append(el);
      await new Promise((r) => setTimeout(r, 1));
    }
    await new Promise((r) => setTimeout(r, 60));
    expect(maxActive).toBe(1);
  });

  it("stop() disconnects: no further emissions after a later mutation", async () => {
    const onNew = vi.fn();
    const handle = startSurveyor(document, [], resolver({ [tokenHash("late")]: [".late"] }), onNew, { flushDelayMs: 0 });
    handle.stop();

    const el = document.createElement("div");
    el.className = "late";
    document.body.append(el);
    await settle();

    expect(onNew).not.toHaveBeenCalled();
  });

  it("self-disables after enough consecutive flushes find nothing new", async () => {
    const onNew = vi.fn();
    startSurveyor(document, [], resolver({ [tokenHash("wanted")]: [".wanted"] }), onNew, {
      flushDelayMs: 0,
      quietFlushesToStop: 2,
    });

    // Well past the threshold, even if some appends coalesce into one flush.
    for (let i = 0; i < 6; i += 1) {
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
