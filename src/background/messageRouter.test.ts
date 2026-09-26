import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";

const browserMock = vi.hoisted(() => ({
  tabs: {
    query: vi.fn(async () => [{ id: 7, url: "https://news.example/story" }] as { id?: number; url?: string }[]),
    get: vi.fn(async (id: number) => ({ id, url: "https://news.example/story", windowId: 1 })),
    update: vi.fn(async () => ({})),
    sendMessage: vi.fn(async (): Promise<unknown> => undefined),
  },
  windows: { update: vi.fn(async () => ({})) },
  scripting: { executeScript: vi.fn(async () => []) },
}));
vi.mock("webextension-polyfill", () => ({ default: browserMock }));

const settings = vi.hoisted(() => ({
  enabled: true,
  filterGroups: {},
  permissionGuardCamera: true,
  permissionGuardMicrophone: false,
  permissionGuardLocation: true,
}));
vi.mock("./settings", () => ({
  addCustomAllowedDomain: vi.fn(async () => undefined),
  addCustomBlockedDomain: vi.fn(async () => undefined),
  addCustomCosmeticRule: vi.fn(async () => undefined),
  addGrayscaleRule: vi.fn(async () => undefined),
  getEffectiveSettings: vi.fn(async () => settings),
  getOrCreateFingerprintSeed: vi.fn(async () => "persistent-seed"),
  getOrCreateSessionFingerprintSeed: vi.fn(async () => "session-seed"),
  scopeFingerprintSeedToSite: vi.fn((seed: string, host: string) => `${seed}@${host}`),
  getSettings: vi.fn(async () => settings),
  importCustomRules: vi.fn(async () => ({ ok: true })),
  isSiteDisabled: vi.fn(async () => false),
  pickAllowedSettingsPatch: vi.fn((patch: unknown) => ({ picked: patch })),
  removeCustomAllowedDomain: vi.fn(async () => undefined),
  removeCustomBlockedDomain: vi.fn(async () => undefined),
  removeCustomCosmeticRule: vi.fn(async () => undefined),
  removeGrayscaleRule: vi.fn(async () => undefined),
  setPerSiteOverride: vi.fn(async () => undefined),
  setSettings: vi.fn(async () => undefined),
  setSiteDisabled: vi.fn(async () => undefined),
}));
vi.mock("./blockStats", () => ({
  combinedBreakdown: vi.fn(() => ({ ads: 3, trackers: 2, popups: 1 })),
  combinedCompanyBreakdown: vi.fn(() => ({ Google: 4 })),
  combinedTotal: vi.fn(() => 9),
  unsortedCount: vi.fn(() => 3),
  recordDynamicCatch: vi.fn(),
  refreshStaticBreakdown: vi.fn(async () => undefined),
}));
vi.mock("./filterGroups", () => ({ getFilterGroupStatus: vi.fn(async () => ({ droppedGroups: [] })) }));
vi.mock("./managedPolicy", () => ({ getManagedPolicy: vi.fn(async () => ({})) }));
vi.mock("./athenaIntegration", () => ({ queueSecurityEvent: vi.fn(async () => undefined) }));
vi.mock("./cosmeticIndex", () => ({
  cosmeticGenericsFor: vi.fn(async () => ({ selectors: [".ad-slot"] })),
  proceduralRulesFor: vi.fn(async () => []),
}));
vi.mock("./cosmeticInject", () => ({ injectGenericSelectors: vi.fn(async () => undefined) }));
vi.mock("./genericSelectorCache", () => ({ rememberGenericSelectors: vi.fn(async () => undefined) }));
vi.mock("./permissionGuard", () => ({ allowPermissionGuardOrigin: vi.fn(async () => undefined) }));
vi.mock("./customRuleStats", () => ({ recordRuleMatches: vi.fn(async () => undefined) }));
vi.mock("./usageStats", () => ({ recordSignalEvent: vi.fn(async () => undefined) }));
vi.mock("./liveHeuristics", () => ({ getFired: vi.fn(() => ({})), recordFired: vi.fn() }));
vi.mock("./liveUpdates", () => ({ fetchAndApply: vi.fn(async () => undefined) }));
vi.mock("./lastNormalTab", () => ({
  getLastNormalTabId: vi.fn(() => 7),
  isNormalPageUrl: vi.fn((url?: string) => typeof url === "string" && url.startsWith("http")),
  pickBestNormalTab: vi.fn(() => null),
}));

const { handleMessage, hostnameOf } = await import("./messageRouter");
const settingsModule = await import("./settings");
const blockStats = await import("./blockStats");
const cosmeticInject = await import("./cosmeticInject");
const genericSelectorCache = await import("./genericSelectorCache");
const usageStats = await import("./usageStats");
const liveHeuristics = await import("./liveHeuristics");

const contentSender = (frameId = 0): Runtime.MessageSender => ({
  tab: { id: 7, url: "https://news.example/story" } as Runtime.MessageSender["tab"],
  frameId,
});
const pageSender: Runtime.MessageSender = {};
const send = (message: unknown, sender: Runtime.MessageSender = pageSender) => handleMessage(message, sender);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hostnameOf", () => {
  it("returns the hostname, or an empty string for anything unparseable", () => {
    expect(hostnameOf("https://a.example/x")).toBe("a.example");
    expect(hostnameOf("not a url")).toBe("");
    expect(hostnameOf(undefined)).toBe("");
  });
});

describe("handleMessage: boundary checks", () => {
  it("ignores anything that isn't a typed message object", () => {
    for (const raw of [null, undefined, "get-status", 42, [], {}]) expect(send(raw)).toBeUndefined();
  });

  it("ignores an unknown message type", () => {
    expect(send({ type: "no-such-message" })).toBeUndefined();
  });

  it("drops messages whose hostname or selector fails validation, without touching settings", () => {
    expect(send({ type: "toggle-site", hostname: 5, disabled: true })).toBeUndefined();
    expect(send({ type: "save-cosmetic-rule", hostname: "a.example", selector: "" })).toBeUndefined();
    expect(send({ type: "remove-grayscale-rule", hostname: "", selector: ".x" })).toBeUndefined();
    expect(send({ type: "set-per-site-override", hostname: "a.example", key: "notARealKey", value: true })).toBeUndefined();
    expect(send({ type: "allow-permission-guard-origin", hostname: "a.example", kind: "usb" })).toBeUndefined();
    expect(settingsModule.setSiteDisabled).not.toHaveBeenCalled();
    expect(settingsModule.addCustomCosmeticRule).not.toHaveBeenCalled();
    expect(settingsModule.removeGrayscaleRule).not.toHaveBeenCalled();
    expect(settingsModule.setPerSiteOverride).not.toHaveBeenCalled();
  });

  it("answers { ok: false } to a rejected custom-domain add, so the UI keeps the input", async () => {
    await expect(send({ type: "add-custom-domain", field: "customBlockedDomains", hostname: "" })).resolves.toEqual({ ok: false });
    await expect(send({ type: "add-custom-domain", field: "somethingElse", hostname: "a.example" })).resolves.toEqual({ ok: false });
    expect(settingsModule.addCustomBlockedDomain).not.toHaveBeenCalled();
  });

  it("rejects a malformed custom-rule import as a whole", () => {
    expect(send({ type: "import-custom-rules", blockedDomains: "a.example", allowedDomains: [], cosmeticRules: {} })).toBeUndefined();
    expect(send({ type: "import-custom-rules", blockedDomains: [], allowedDomains: [], cosmeticRules: [] })).toBeUndefined();
    expect(settingsModule.importCustomRules).not.toHaveBeenCalled();
  });

  it("drops a usage signal with an unknown signal name", () => {
    expect(send({ type: "record-usage-signal", hostname: "a.example", signal: "made-up", count: 1 }, contentSender())).toBeUndefined();
    expect(usageStats.recordSignalEvent).not.toHaveBeenCalled();
  });

  it("drops an Athena override with no reason or an overlong one", () => {
    expect(send({ type: "report-athena-override", reason: "" }, contentSender())).toBeUndefined();
    expect(send({ type: "report-athena-override", reason: "x".repeat(100_000) }, contentSender())).toBeUndefined();
  });
});

describe("handleMessage: get-status", () => {
  it("refreshes the tab's matches, then reports its counts and the permission guard", async () => {
    const status = await send({ type: "get-status" });
    expect(browserMock.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(blockStats.refreshStaticBreakdown).toHaveBeenCalledWith(7, "news.example");
    expect(status).toEqual({
      hostname: "news.example",
      siteDisabled: false,
      enabled: true,
      blockedOnTab: 9,
      unsorted: 3,
      breakdown: { ads: 3, trackers: 2, popups: 1 },
      companyBreakdown: { Google: 4 },
      droppedFilterGroups: [],
      permissionGuard: { camera: true, microphone: false, location: true },
    });
  });

  it("uses the sender's own tab when a content script asks", async () => {
    await send({ type: "get-status" }, contentSender());
    expect(browserMock.tabs.query).not.toHaveBeenCalled();
  });

  it("reports zeros when there is no tab at all", async () => {
    browserMock.tabs.query.mockResolvedValueOnce([]);
    const status = (await send({ type: "get-status" })) as { blockedOnTab: number; unsorted: number; hostname: string };
    expect(status.blockedOnTab).toBe(0);
    expect(status.unsorted).toBe(0);
    expect(status.hostname).toBe("");
  });
});

describe("handleMessage: settings writes", () => {
  it("routes valid writes to the matching settings function", async () => {
    await send({ type: "toggle-site", hostname: "a.example", disabled: true });
    expect(settingsModule.setSiteDisabled).toHaveBeenCalledWith("a.example", true);

    await expect(send({ type: "add-custom-domain", field: "customAllowedDomains", hostname: "a.example" })).resolves.toEqual({ ok: true });
    expect(settingsModule.addCustomAllowedDomain).toHaveBeenCalledWith("a.example");

    await send({ type: "remove-custom-domain", field: "customBlockedDomains", hostname: "b.example" });
    expect(settingsModule.removeCustomBlockedDomain).toHaveBeenCalledWith("b.example");

    await send({ type: "save-grayscale-rule", hostname: "a.example", selector: ".feed" });
    expect(settingsModule.addGrayscaleRule).toHaveBeenCalledWith("a.example", ".feed");
  });

  it("passes a settings patch through the allow-list before saving it", async () => {
    await send({ type: "set-settings-patch", patch: { enabled: false } });
    expect(settingsModule.pickAllowedSettingsPatch).toHaveBeenCalledWith({ enabled: false });
    expect(settingsModule.setSettings).toHaveBeenCalledWith({ picked: { enabled: false } });
  });

  it("refuses an imported settings file that doesn't validate", async () => {
    await expect(send({ type: "import-settings", payload: "garbage" })).resolves.toEqual({ ok: false });
    expect(settingsModule.setSettings).not.toHaveBeenCalled();
  });
});

describe("handleMessage: content-script requests", () => {
  it("counts a caught pop-up against the sender's tab", () => {
    expect(send({ type: "blocked", url: "https://popup.example/x" }, contentSender())).toBeUndefined();
    expect(blockStats.recordDynamicCatch).toHaveBeenCalledWith(7, "news.example");
  });

  it("injects and remembers generic selectors for the top frame", async () => {
    await expect(send({ type: "get-cosmetic-generics", hostname: "news.example", hashes: ["abc"] }, contentSender(0))).resolves.toEqual({
      selectors: [".ad-slot"],
    });
    expect(cosmeticInject.injectGenericSelectors).toHaveBeenCalledWith(7, 0, [".ad-slot"]);
    expect(genericSelectorCache.rememberGenericSelectors).toHaveBeenCalledWith("news.example", [".ad-slot"]);
  });

  it("injects but does not remember selectors found in a subframe", async () => {
    await send({ type: "get-cosmetic-generics", hostname: "news.example", hashes: ["abc"] }, contentSender(3));
    expect(cosmeticInject.injectGenericSelectors).toHaveBeenCalledWith(7, 3, [".ad-slot"]);
    expect(genericSelectorCache.rememberGenericSelectors).not.toHaveBeenCalled();
  });

  it("answers an empty list without a lookup when no hash is usable", async () => {
    await expect(
      send({ type: "get-cosmetic-generics", hostname: "news.example", hashes: [1, "", "x".repeat(40)] }, contentSender())
    ).resolves.toEqual({ selectors: [] });
    expect(cosmeticInject.injectGenericSelectors).not.toHaveBeenCalled();
  });

  it("scopes the fingerprint seed to the embedding tab's site", async () => {
    await expect(send({ type: "get-fingerprint-seed", session: true }, contentSender(2))).resolves.toEqual({
      seed: "session-seed@news.example",
    });
  });

  it("records a valid usage signal in both the live counter and the history", async () => {
    await send({ type: "record-usage-signal", hostname: "news.example", signal: "feedAdRemoval", count: 4 }, contentSender());
    expect(liveHeuristics.recordFired).toHaveBeenCalledWith(7, "feedAdRemoval", 4);
    expect(usageStats.recordSignalEvent).toHaveBeenCalledWith("feedAdRemoval", "news.example", 4);
  });
});

describe("handleMessage: start-element-picker", () => {
  it("focuses the last normal tab and starts the picker there", async () => {
    await expect(send({ type: "start-element-picker" })).resolves.toEqual({ ok: true });
    expect(browserMock.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(browserMock.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "start-picker" });
    expect(browserMock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("injects the picker first when the tab has no receiver yet", async () => {
    browserMock.tabs.sendMessage.mockRejectedValueOnce(new Error("no receiver"));
    await expect(send({ type: "start-element-picker" })).resolves.toEqual({ ok: true });
    expect(browserMock.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["element-picker.js"] });
  });

  it("reports failure on a page scripts can't run on", async () => {
    browserMock.tabs.sendMessage.mockRejectedValueOnce(new Error("restricted")).mockRejectedValueOnce(new Error("restricted"));
    await expect(send({ type: "start-element-picker" })).resolves.toEqual({ ok: false });
  });
});
