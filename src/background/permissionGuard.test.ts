import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../types";

const camera = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));
const microphone = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));
const location = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));

vi.mock("webextension-polyfill", () => ({
  default: { contentSettings: { camera, microphone, location } },
}));

import { allowPermissionGuardOrigin, applyPermissionGuard } from "./permissionGuard";

const settings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

beforeEach(() => {
  vi.clearAllMocks();
  camera.set.mockResolvedValue(undefined);
  camera.clear.mockResolvedValue(undefined);
  microphone.set.mockResolvedValue(undefined);
  microphone.clear.mockResolvedValue(undefined);
  location.set.mockResolvedValue(undefined);
  location.clear.mockResolvedValue(undefined);
});

describe("applyPermissionGuard", () => {
  it("does nothing for every kind when all guard flags are off (default)", async () => {
    await applyPermissionGuard(DEFAULT_SETTINGS);
    expect(camera.clear).toHaveBeenCalledWith({});
    expect(microphone.clear).toHaveBeenCalledWith({});
    expect(location.clear).toHaveBeenCalledWith({});
    expect(camera.set).not.toHaveBeenCalled();
    expect(microphone.set).not.toHaveBeenCalled();
    expect(location.set).not.toHaveBeenCalled();
  });

  it("blocks camera globally when its guard flag is on", async () => {
    await applyPermissionGuard(settings({ permissionGuardCamera: true }));
    expect(camera.set).toHaveBeenCalledWith({ primaryPattern: "<all_urls>", setting: "block" });
    expect(camera.clear).not.toHaveBeenCalled();
  });

  it("handles the three kinds independently", async () => {
    await applyPermissionGuard(settings({ permissionGuardCamera: true, permissionGuardMicrophone: false }));
    expect(camera.set).toHaveBeenCalledWith({ primaryPattern: "<all_urls>", setting: "block" });
    expect(microphone.clear).toHaveBeenCalledWith({});
    expect(microphone.set).not.toHaveBeenCalled();
  });

  it("clears (not re-asks) a guard flag that was turned back off", async () => {
    await applyPermissionGuard(settings({ permissionGuardLocation: false }));
    expect(location.clear).toHaveBeenCalledWith({});
    expect(location.set).not.toHaveBeenCalled();
  });

  it("swallows a contentSettings-API failure without throwing", async () => {
    camera.set.mockRejectedValue(new Error("locked by enterprise policy"));
    await expect(applyPermissionGuard(settings({ permissionGuardCamera: true }))).resolves.toBeUndefined();
  });

  it("no-ops entirely when contentSettings is unavailable (Firefox)", async () => {
    vi.doMock("webextension-polyfill", () => ({ default: {} }));
    vi.resetModules();
    const mod = await import("./permissionGuard");
    await expect(mod.applyPermissionGuard(settings({ permissionGuardCamera: true }))).resolves.toBeUndefined();
    vi.doUnmock("webextension-polyfill");
    vi.resetModules();
  });
});

describe("allowPermissionGuardOrigin", () => {
  it("sets an allow override scoped to the given hostname", async () => {
    await allowPermissionGuardOrigin("microphone", "meet.example.com");
    expect(microphone.set).toHaveBeenCalledWith({
      primaryPattern: "*://meet.example.com/*",
      setting: "allow",
    });
  });

  it("swallows a set() failure without throwing", async () => {
    location.set.mockRejectedValue(new Error("invalid pattern"));
    await expect(allowPermissionGuardOrigin("location", "example.com")).resolves.toBeUndefined();
  });
});
