// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../types";
import { changedKeys, openCheckup, type CheckupOptions, type Level } from "./checkup";

const t = (_key: string, fallback: string) => fallback;
const NAMES: Record<Level, string> = { lite: "Light", standard: "Balanced", strict: "Strict" };
let apply: ReturnType<typeof vi.fn<CheckupOptions["apply"]>>;

function open(settings: Settings, currentLevel: Level | null = "standard") {
  return openCheckup(document, {
    t,
    settings,
    currentLevel,
    levelPatch: (level) => (level === "strict" ? { webrtcLeakProtection: true, fingerprintResistance: true } : {}),
    levelName: (level) => NAMES[level],
    levelDesc: () => "",
    privacy: [
      { key: "blockThirdPartyCookies", title: "Block cross-site cookies", desc: "" },
      { key: "webrtcLeakProtection", title: "Keep your IP address private", desc: "" },
    ],
    annoyances: [{ key: "cookieBannerAutoReject", title: "Reject cookie banners", desc: "" }],
    apply,
  });
}
const next = () => document.querySelector<HTMLButtonElement>(".checkup-actions .primary")!.click();
const title = () => document.getElementById("checkup-title")?.textContent;

beforeEach(() => {
  document.body.innerHTML = "";
  apply = vi.fn();
});

describe("changedKeys", () => {
  it("keeps only what would change, with the old values", () => {
    const settings = { ...DEFAULT_SETTINGS, blockThirdPartyCookies: false, cookieBannerAutoReject: true };
    expect(changedKeys(settings, { blockThirdPartyCookies: true, cookieBannerAutoReject: true })).toEqual({
      patch: { blockThirdPartyCookies: true },
      before: { blockThirdPartyCookies: false },
    });
  });
});

describe("the checkup", () => {
  it("walks three steps, shows a summary, and applies only on Done", () => {
    open({ ...DEFAULT_SETTINGS });
    expect(title()).toBe("How much to block");
    expect(document.querySelector('.checkup-level[aria-checked="true"]')?.textContent).toContain("Balanced");
    next();
    expect(title()).toBe("Privacy extras");
    const cookies = document.querySelector<HTMLInputElement>(".checkup-row input")!;
    cookies.checked = true;
    cookies.dispatchEvent(new Event("change"));
    next();
    expect(title()).toBe("Annoyances");
    next();
    expect(title()).toBe("Here's what changes");
    expect(document.querySelector(".checkup-summary")?.textContent).toBe("Block cross-site cookies: on");
    expect(apply).not.toHaveBeenCalled();
    next();
    expect(apply).toHaveBeenCalledWith({ blockThirdPartyCookies: true }, { blockThirdPartyCookies: false }, 1);
    expect(document.querySelector(".checkup")).toBeNull();
  });

  it("starts the extras from a newly picked level", () => {
    open({ ...DEFAULT_SETTINGS, webrtcLeakProtection: false });
    document.querySelector<HTMLButtonElement>('.checkup-level[data-level="strict"]')!.click();
    next();
    const ip = document.querySelectorAll<HTMLInputElement>(".checkup-row input")[1]!;
    expect(ip.checked).toBe(true);
    next();
    next();
    expect(document.querySelector(".checkup-summary")?.textContent).toContain("Level: Strict");
  });

  it("offers to keep a hand-picked mix, and says so when nothing changes", () => {
    open({ ...DEFAULT_SETTINGS }, null);
    expect(document.querySelector('.checkup-level[data-level="mix"]')?.getAttribute("aria-checked")).toBe("true");
    next();
    next();
    next();
    expect(document.querySelector(".checkup-lead")?.textContent).toBe("Nothing to change. Your protection stays as it is.");
    next();
    expect(apply).not.toHaveBeenCalled();
  });

  it("closes on Escape without saving", () => {
    open({ ...DEFAULT_SETTINGS });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".checkup")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});
