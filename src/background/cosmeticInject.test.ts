import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LIVE_COSMETIC_FIXES_KEY, LIVE_YOUTUBE_QUICK_FIXES_KEY, type Settings } from "../types";
import type { CosmeticSliceResponse } from "../types";

const h = vi.hoisted(() => ({
  insertCSS: vi.fn(),
  storageGet: vi.fn(),
  getEffectiveSettings: vi.fn(),
  isSiteDisabled: vi.fn(),
  cosmeticSliceFor: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    scripting: { insertCSS: h.insertCSS },
    storage: { local: { get: h.storageGet } },
    runtime: { getURL: (p: string) => p },
  },
}));
vi.mock("./settings", () => ({
  getEffectiveSettings: h.getEffectiveSettings,
  isSiteDisabled: h.isSiteDisabled,
}));
vi.mock("./cosmeticIndex", () => ({ cosmeticSliceFor: h.cosmeticSliceFor }));

import { injectCosmeticsForCommit, injectGenericSelectors } from "./cosmeticInject";

const slice = (patch: Partial<CosmeticSliceResponse> = {}): CosmeticSliceResponse => ({
  domainSelectors: [],
  injectRules: [],
  genericHigh: [],
  hasTokenIndex: true,
  ...patch,
});
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

beforeEach(() => {
  vi.clearAllMocks();
  h.insertCSS.mockResolvedValue(undefined);
  h.storageGet.mockResolvedValue({});
  h.getEffectiveSettings.mockResolvedValue(settings());
  h.isSiteDisabled.mockResolvedValue(false);
  h.cosmeticSliceFor.mockResolvedValue(slice());
});

describe("injectCosmeticsForCommit", () => {
  it("injects the bundled + user CSS as a user-origin stylesheet into the top frame", async () => {
    h.cosmeticSliceFor.mockResolvedValue(
      slice({ genericHigh: [".sponsored"], domainSelectors: [".ad-rail"], injectRules: [["#promo", "height:0!important"]] })
    );
    await injectCosmeticsForCommit(7, "https://news.example.com/story");

    expect(h.insertCSS).toHaveBeenCalledTimes(1);
    expect(h.insertCSS).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 7, frameIds: [0] }, origin: "USER" })
    );
    const css = String((h.insertCSS.mock.calls[0]?.[0] as { css?: string }).css);
    expect(css).toContain(".sponsored");
    expect(css).toContain(".ad-rail");
    expect(css).toContain("#promo{height:0!important}");
    expect(css).toContain("display:none!important");
  });

  it("merges the user's custom hide / grayscale rules and the live-fix map", async () => {
    h.getEffectiveSettings.mockResolvedValue(
      settings({
        customCosmeticRules: { "example.com": [".my-hide"] },
        customGrayscaleRules: { "example.com": [".my-gray"] },
      })
    );
    h.storageGet.mockResolvedValue({ [LIVE_COSMETIC_FIXES_KEY]: { "example.com": [".live-fix"] } });

    await injectCosmeticsForCommit(1, "https://example.com/");
    const css = String((h.insertCSS.mock.calls[0]?.[0] as { css?: string }).css);
    expect(css).toContain(".my-hide");
    expect(css).toContain(".live-fix");
    expect(css).toContain(".my-gray");
    expect(css).toContain("filter:grayscale(1)!important");
  });

  it("also merges the YouTube-scoped live-fix channel, keyed by its own hostname", async () => {
    h.storageGet.mockImplementation((key: string) =>
      Promise.resolve(
        key === LIVE_YOUTUBE_QUICK_FIXES_KEY
          ? { [LIVE_YOUTUBE_QUICK_FIXES_KEY]: { "www.youtube.com": [".yt-quick-fix"] } }
          : {}
      )
    );

    await injectCosmeticsForCommit(1, "https://www.youtube.com/watch?v=1");
    const css = String((h.insertCSS.mock.calls[0]?.[0] as { css?: string }).css);
    expect(css).toContain(".yt-quick-fix");
  });

  it("never leaks a YouTube-scoped fix onto an unrelated hostname", async () => {
    h.storageGet.mockImplementation((key: string) =>
      Promise.resolve(
        key === LIVE_YOUTUBE_QUICK_FIXES_KEY
          ? { [LIVE_YOUTUBE_QUICK_FIXES_KEY]: { "www.youtube.com": [".yt-quick-fix"] } }
          : {}
      )
    );

    await injectCosmeticsForCommit(1, "https://example.com/");
    expect(h.insertCSS).not.toHaveBeenCalled();
  });

  it("does nothing when protection is off globally", async () => {
    h.getEffectiveSettings.mockResolvedValue(settings({ enabled: false }));
    await injectCosmeticsForCommit(1, "https://example.com/");
    expect(h.insertCSS).not.toHaveBeenCalled();
  });

  it("does nothing when the site is paused", async () => {
    h.isSiteDisabled.mockResolvedValue(true);
    await injectCosmeticsForCommit(1, "https://example.com/");
    expect(h.insertCSS).not.toHaveBeenCalled();
  });

  it("does nothing for a URL with no usable hostname", async () => {
    await injectCosmeticsForCommit(1, "about:blank");
    expect(h.getEffectiveSettings).not.toHaveBeenCalled();
    expect(h.insertCSS).not.toHaveBeenCalled();
  });

  it("does nothing (and does not throw) when the slice lookup fails", async () => {
    h.cosmeticSliceFor.mockRejectedValue(new Error("meta fetch failed"));
    await expect(injectCosmeticsForCommit(1, "https://example.com/")).resolves.toBeUndefined();
    expect(h.insertCSS).not.toHaveBeenCalled();
  });

  it("does nothing when there is no CSS to inject", async () => {
    await injectCosmeticsForCommit(1, "https://example.com/"); // default slice + settings = empty
    expect(h.insertCSS).not.toHaveBeenCalled();
  });

  it("swallows an insertCSS rejection (tab closed / restricted page)", async () => {
    h.cosmeticSliceFor.mockResolvedValue(slice({ genericHigh: [".x"] }));
    h.insertCSS.mockRejectedValue(new Error("Cannot access contents of the page"));
    await expect(injectCosmeticsForCommit(1, "https://example.com/")).resolves.toBeUndefined();
  });
});

describe("injectGenericSelectors", () => {
  it("injects the selectors user-origin into the given frame", async () => {
    await injectGenericSelectors(4, 0, [".late-ad", ".promo"]);
    expect(h.insertCSS).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 4, frameIds: [0] }, origin: "USER" })
    );
    const css = String((h.insertCSS.mock.calls[0]?.[0] as { css?: string }).css);
    expect(css).toContain(".late-ad");
    expect(css).toContain(".promo");
  });

  it("is a no-op for an empty selector list", async () => {
    await injectGenericSelectors(4, 0, []);
    expect(h.insertCSS).not.toHaveBeenCalled();
  });
});
