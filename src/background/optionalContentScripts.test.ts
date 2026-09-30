import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../types";

const scripting = vi.hoisted(() => ({
  getRegisteredContentScripts: vi.fn(),
  registerContentScripts: vi.fn(),
  unregisterContentScripts: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({ default: { scripting } }));

import { OPTIONAL_SCRIPTS, pausedSitePatterns, planReconcile, reconcileOptionalContentScripts } from "./optionalContentScripts";

const settings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
const CONSENT = "moat-consent-rejector";
const LEAKED = "moat-leaked-password-check";
const ADMIRAL = "moat-admiral-guard";
// The Admiral guard is registered whenever Moat is on, with no sites paused.
const ADMIRAL_NONE_PAUSED = { id: ADMIRAL, excludeMatches: [] };

beforeEach(() => {
  vi.clearAllMocks();
  scripting.getRegisteredContentScripts.mockResolvedValue([]);
  scripting.registerContentScripts.mockResolvedValue(undefined);
  scripting.unregisterContentScripts.mockResolvedValue(undefined);
});

describe("planReconcile", () => {
  it("registers a script whose setting is on and which isn't registered yet", () => {
    const { register, unregisterIds } = planReconcile(settings({ cookieBannerAutoReject: true }), [ADMIRAL_NONE_PAUSED]);
    expect(register.map((s) => s.id)).toEqual([CONSENT]);
    expect(unregisterIds).toEqual([]);
  });

  it("unregisters a script whose setting went off", () => {
    const { register, unregisterIds } = planReconcile(settings({ cookieBannerAutoReject: false }), [CONSENT, ADMIRAL_NONE_PAUSED]);
    expect(register).toEqual([]);
    expect(unregisterIds).toEqual([CONSENT]);
  });

  it("is a no-op when registration already matches the settings", () => {
    const on = settings({ cookieBannerAutoReject: true, leakedPasswordCheck: true });
    const { register, unregisterIds } = planReconcile(on, [CONSENT, LEAKED, ADMIRAL_NONE_PAUSED]);
    expect(register).toEqual([]);
    expect(unregisterIds).toEqual([]);
  });

  it("handles the two scripts independently", () => {
    const { register, unregisterIds } = planReconcile(
      settings({ cookieBannerAutoReject: true, leakedPasswordCheck: false }),
      [LEAKED, ADMIRAL_NONE_PAUSED]
    );
    expect(register.map((s) => s.id)).toEqual([CONSENT]);
    expect(unregisterIds).toEqual([LEAKED]);
  });

  it("defaults register the cookie-banner rejector and the Admiral guard", () => {
    const { register, unregisterIds } = planReconcile(DEFAULT_SETTINGS, []);
    expect(register.map((s) => s.id)).toEqual([CONSENT, ADMIRAL]);
    expect(unregisterIds).toEqual([]);
  });

  it("re-registers the Admiral guard when the paused sites change, and not otherwise", () => {
    const paused = settings({ disabledSites: ["weather.com"] });
    expect(planReconcile(paused, [CONSENT, ADMIRAL_NONE_PAUSED])).toEqual({
      register: [expect.objectContaining({ id: ADMIRAL })],
      unregisterIds: [ADMIRAL],
    });
    expect(planReconcile(paused, [CONSENT, { id: ADMIRAL, excludeMatches: ["*://*.weather.com/*"] }])).toEqual({
      register: [],
      unregisterIds: [],
    });
  });

  it("drops the Admiral guard while Moat is off everywhere", () => {
    expect(planReconcile(settings({ enabled: false }), [CONSENT, ADMIRAL_NONE_PAUSED]).unregisterIds).toEqual([ADMIRAL]);
  });
});

describe("pausedSitePatterns", () => {
  it("covers each paused site and its subdomains, skipping anything that isn't a host", () => {
    expect(pausedSitePatterns(settings({ disabledSites: ["weather.com", "10.0.0.1", "bad host/", "Shop.Example.org"] }))).toEqual([
      "*://*.shop.example.org/*",
      "*://*.weather.com/*",
      "*://10.0.0.1/*",
    ]);
  });
});

describe("reconcileOptionalContentScripts", () => {
  it("registers the enabled script with the expected shape", async () => {
    await reconcileOptionalContentScripts(settings({ cookieBannerAutoReject: false, leakedPasswordCheck: true }));
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: LEAKED,
        js: ["leaked-password-check.js"],
        matches: ["<all_urls>"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      }),
    ]);
    // Each script in its own call, so one rejected can't sink the rest.
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: ADMIRAL,
        js: ["admiral-guard.js"],
        matches: ["<all_urls>"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it("unregisters a stale script and registers a newly-wanted one in the same pass", async () => {
    scripting.getRegisteredContentScripts.mockResolvedValue([{ id: CONSENT }]);
    await reconcileOptionalContentScripts(settings({ cookieBannerAutoReject: false, leakedPasswordCheck: true }));
    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [CONSENT] });
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({ id: LEAKED })]);
  });

  it("does nothing when the registration already matches", async () => {
    scripting.getRegisteredContentScripts.mockResolvedValue([{ id: CONSENT }, ADMIRAL_NONE_PAUSED]);
    await reconcileOptionalContentScripts(settings({ cookieBannerAutoReject: true }));
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it("leaves paused sites out of the Admiral guard", async () => {
    scripting.getRegisteredContentScripts.mockResolvedValue([{ id: CONSENT }, ADMIRAL_NONE_PAUSED]);
    await reconcileOptionalContentScripts(settings({ disabledSites: ["weather.com"] }));
    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [ADMIRAL] });
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: ADMIRAL, excludeMatches: ["*://*.weather.com/*"] }),
    ]);
  });

  it("swallows a scripting-API failure without throwing", async () => {
    scripting.getRegisteredContentScripts.mockRejectedValue(new Error("no scripting API"));
    await expect(reconcileOptionalContentScripts(settings({ leakedPasswordCheck: true }))).resolves.toBeUndefined();
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it("only queries for its own script ids", async () => {
    await reconcileOptionalContentScripts(DEFAULT_SETTINGS);
    expect(scripting.getRegisteredContentScripts).toHaveBeenCalledWith({
      ids: OPTIONAL_SCRIPTS.map((s) => s.id),
    });
  });
});
