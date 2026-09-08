import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../types";

const scripting = vi.hoisted(() => ({
  getRegisteredContentScripts: vi.fn(),
  registerContentScripts: vi.fn(),
  unregisterContentScripts: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({ default: { scripting } }));

import { OPTIONAL_SCRIPTS, planReconcile, reconcileOptionalContentScripts } from "./optionalContentScripts";

const settings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
const CONSENT = "moat-consent-rejector";
const LEAKED = "moat-leaked-password-check";

beforeEach(() => {
  vi.clearAllMocks();
  scripting.getRegisteredContentScripts.mockResolvedValue([]);
  scripting.registerContentScripts.mockResolvedValue(undefined);
  scripting.unregisterContentScripts.mockResolvedValue(undefined);
});

describe("planReconcile", () => {
  it("registers a script whose setting is on and which isn't registered yet", () => {
    const { register, unregisterIds } = planReconcile(settings({ cookieBannerAutoReject: true }), []);
    expect(register.map((s) => s.id)).toEqual([CONSENT]);
    expect(unregisterIds).toEqual([]);
  });

  it("unregisters a script whose setting went off", () => {
    const { register, unregisterIds } = planReconcile(settings({ cookieBannerAutoReject: false }), [CONSENT]);
    expect(register).toEqual([]);
    expect(unregisterIds).toEqual([CONSENT]);
  });

  it("is a no-op when registration already matches the settings", () => {
    const on = settings({ cookieBannerAutoReject: true, leakedPasswordCheck: true });
    const { register, unregisterIds } = planReconcile(on, [CONSENT, LEAKED]);
    expect(register).toEqual([]);
    expect(unregisterIds).toEqual([]);
  });

  it("handles the two scripts independently", () => {
    const { register, unregisterIds } = planReconcile(
      settings({ cookieBannerAutoReject: true, leakedPasswordCheck: false }),
      [LEAKED]
    );
    expect(register.map((s) => s.id)).toEqual([CONSENT]);
    expect(unregisterIds).toEqual([LEAKED]);
  });

  it("defaults (both off) register nothing", () => {
    const { register, unregisterIds } = planReconcile(DEFAULT_SETTINGS, []);
    expect(register).toEqual([]);
    expect(unregisterIds).toEqual([]);
  });
});

describe("reconcileOptionalContentScripts", () => {
  it("registers the enabled script with the expected shape", async () => {
    await reconcileOptionalContentScripts(settings({ leakedPasswordCheck: true }));
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: LEAKED,
        js: ["leaked-password-check.js"],
        matches: ["<all_urls>"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      }),
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
    scripting.getRegisteredContentScripts.mockResolvedValue([{ id: CONSENT }]);
    await reconcileOptionalContentScripts(settings({ cookieBannerAutoReject: true }));
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
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
