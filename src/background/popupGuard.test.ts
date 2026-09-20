// popupGuard.ts's orchestration (the pendingWatch Map, WATCH_WINDOW_MS
// timing, closeSilently) had no test coverage at all before this file --
// only its pure dependency (redirectDomainMatch.ts) and an unrelated
// content-script rate limiter were tested. webextension-polyfill's event
// listeners are captured here (not just stubbed as no-ops) so tests can
// actually fire them and observe what popupGuard.ts does in response.
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordDynamicCatch = vi.fn(async () => {});
vi.mock("./blockStats", () => ({ recordDynamicCatch }));

type Listener<T extends unknown[]> = (...args: T) => void | Promise<void>;

const listeners: {
  onCreatedNavigationTarget?: Listener<[{ tabId: number; sourceTabId: number | undefined; url: string }]>;
  onUpdated?: Listener<[number, { url?: string }]>;
  onRemoved?: Listener<[number]>;
} = {};

const tabsRemove = vi.fn(async () => {});
const tabsGet = vi.fn(async (id: number) => ({ id, url: "https://opener.example.com/page" }));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: { getURL: (path: string) => `moz-extension://test-id/${path}` },
    storage: { local: { get: async () => ({}) } },
    webNavigation: {
      onCreatedNavigationTarget: {
        addListener: (fn: NonNullable<typeof listeners.onCreatedNavigationTarget>) => {
          listeners.onCreatedNavigationTarget = fn;
        },
      },
    },
    tabs: {
      onUpdated: {
        addListener: (fn: NonNullable<typeof listeners.onUpdated>) => {
          listeners.onUpdated = fn;
        },
      },
      onRemoved: {
        addListener: (fn: NonNullable<typeof listeners.onRemoved>) => {
          listeners.onRemoved = fn;
        },
      },
      remove: tabsRemove,
      get: tabsGet,
    },
  },
}));

const KNOWN_REDIRECT_DOMAIN = "known-bad.example";

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("popupGuard", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();
    tabsRemove.mockClear();
    tabsGet.mockClear();
    recordDynamicCatch.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => [KNOWN_REDIRECT_DOMAIN] }))
    );
    const { initPopupGuard } = await import("./popupGuard");
    initPopupGuard();
    await flush();
  });

  it("closes a tab immediately if its very first URL is a known redirect domain", async () => {
    await listeners.onCreatedNavigationTarget!({ tabId: 1, sourceTabId: 9, url: `https://${KNOWN_REDIRECT_DOMAIN}/` });
    await flush();
    expect(tabsRemove).toHaveBeenCalledWith(1);
  });

  it("does not close a tab whose first URL is unrelated, but keeps watching it", async () => {
    await listeners.onCreatedNavigationTarget!({ tabId: 2, sourceTabId: 9, url: "about:blank" });
    await flush();
    expect(tabsRemove).not.toHaveBeenCalled();

    // A later navigation to a known redirect domain, within the watch
    // window, still catches it.
    await listeners.onUpdated!(2, { url: `https://${KNOWN_REDIRECT_DOMAIN}/` });
    await flush();
    expect(tabsRemove).toHaveBeenCalledWith(2);
  });

  it("stops watching a tab once it's removed, even if it later somehow fires onUpdated", async () => {
    await listeners.onCreatedNavigationTarget!({ tabId: 3, sourceTabId: 9, url: "about:blank" });
    await flush();
    listeners.onRemoved!(3);

    await listeners.onUpdated!(3, { url: `https://${KNOWN_REDIRECT_DOMAIN}/` });
    await flush();
    expect(tabsRemove).not.toHaveBeenCalled();
  });

  it("ignores an onUpdated event with no url change at all", async () => {
    await listeners.onCreatedNavigationTarget!({ tabId: 4, sourceTabId: 9, url: "about:blank" });
    await flush();
    await listeners.onUpdated!(4, {}); // e.g. a title/favicon-only update
    await flush();
    expect(tabsRemove).not.toHaveBeenCalled();
  });

  it("attributes the dynamic-catch counter to the opener tab, not the popup's own tab", async () => {
    await listeners.onCreatedNavigationTarget!({ tabId: 5, sourceTabId: 42, url: `https://${KNOWN_REDIRECT_DOMAIN}/` });
    await flush();
    expect(tabsGet).toHaveBeenCalledWith(42);
    expect(recordDynamicCatch).toHaveBeenCalledWith(42, "opener.example.com");
  });

  // Regression: a redirect deliberately delayed to land at/after the watch
  // window's expiry used to sail through untouched -- the onUpdated handler
  // checked `Date.now() > watch.expires` and deleted the watch entry
  // without ever looking at the URL that arrived in that same event. Now it
  // checks the URL even on the expiring update.
  it("still catches a redirect that lands exactly when the watch window has just expired", async () => {
    vi.useFakeTimers();
    try {
      await listeners.onCreatedNavigationTarget!({ tabId: 6, sourceTabId: 9, url: "about:blank" });
      await flush();

      vi.advanceTimersByTime(5000); // past WATCH_WINDOW_MS (4000ms)
      await listeners.onUpdated!(6, { url: `https://${KNOWN_REDIRECT_DOMAIN}/` });
      await flush();

      expect(tabsRemove).toHaveBeenCalledWith(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resurrect a truly-expired watch for a later, unrelated URL", async () => {
    vi.useFakeTimers();
    try {
      await listeners.onCreatedNavigationTarget!({ tabId: 7, sourceTabId: 9, url: "about:blank" });
      await flush();

      vi.advanceTimersByTime(5000);
      await listeners.onUpdated!(7, { url: "https://not-a-redirect.example/" });
      await flush();
      expect(tabsRemove).not.toHaveBeenCalled();

      // The watch was deleted on that expired check -- a second, later
      // update to a known redirect domain must not catch it anymore.
      await listeners.onUpdated!(7, { url: `https://${KNOWN_REDIRECT_DOMAIN}/` });
      await flush();
      expect(tabsRemove).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
