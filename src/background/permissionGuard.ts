// Blocks the camera/mic/location "ambush" prompt -- a site calling
// getUserMedia()/geolocation.getCurrentPosition() the instant it loads, with
// no user gesture, so the native browser permission bar appears unprompted.
//
// This deliberately does NOT patch page JS the way mainWorldGuard.ts /
// fingerprintGuard.ts patch fingerprinting surfaces. chrome.contentSettings
// lets an extension set the real browser-level per-origin default for
// camera/microphone/location (see MDN/Chrome docs: "allow" | "block" |
// "ask"), which is more robust and can't be bypassed by page script the way
// an in-page monkey-patch can. The trade-off is coarser: Chrome gives no
// page-level hook to intercept/reskin its own permission bar, so the only
// lever here is binary per origin -- silently blocked (no prompt at all) or
// fully allowed (the site works normally, going through Chrome's own prompt
// the first time if there's no existing browser-level grant).
//
// Firefox does not implement contentSettings.camera/microphone/location (its
// contentSettings API only covers the original small Chrome-parity surface
// -- cookies/images/javascript/popups/etc.), so every call here is guarded
// and silently no-ops there, same posture as privacySettings.ts's `apply`.
import browser from "webextension-polyfill";
import type { Settings } from "../types";

export type PermissionGuardKind = "camera" | "microphone" | "location";

export const PERMISSION_GUARD_KINDS: PermissionGuardKind[] = ["camera", "microphone", "location"];

interface ContentSetting {
  set(details: { primaryPattern: string; setting: string }): Promise<void>;
  clear(details: object): Promise<void>;
}

interface ChromeContentSettings {
  camera?: ContentSetting;
  microphone?: ContentSetting;
  location?: ContentSetting;
}

function contentSettingsApi(): ChromeContentSettings | undefined {
  return (browser as unknown as { contentSettings?: ChromeContentSettings }).contentSettings;
}

function settingFor(api: ChromeContentSettings, kind: PermissionGuardKind): ContentSetting | undefined {
  return api[kind];
}

function guardFlagFor(settings: Settings, kind: PermissionGuardKind): boolean {
  if (kind === "camera") return settings.permissionGuardCamera;
  if (kind === "microphone") return settings.permissionGuardMicrophone;
  return settings.permissionGuardLocation;
}

/** Blocks every origin by default for a kind whose guard flag is on;
 * `.clear({})` (not `.set({setting:"ask"})`) relinquishes the extension's
 * override entirely when off, same reasoning as privacySettings.ts's
 * applyOrClear -- a fresh install with every guard off takes ownership of
 * nothing rather than parking an explicit "ask" override in
 * chrome://settings/content. */
export async function applyPermissionGuard(settings: Settings): Promise<void> {
  const api = contentSettingsApi();
  if (!api) return;

  await Promise.all(
    PERMISSION_GUARD_KINDS.map(async (kind) => {
      const setting = settingFor(api, kind);
      if (!setting) return;
      try {
        if (guardFlagFor(settings, kind)) {
          await setting.set({ primaryPattern: "<all_urls>", setting: "block" });
        } else {
          await setting.clear({});
        }
      } catch {
        // Unsupported on this browser/version, locked by enterprise policy,
        // or Incognito rejecting the scope -- none of that should take the
        // rest of the extension down with it (same reasoning as
        // privacySettings.ts's own catches).
      }
    })
  );
}

/** Explicitly allow one origin through a guard the user has turned on --
 * the popup's "Allow camera/mic/location on this site" action. Scoped to
 * "*://<hostname>/*" (scheme-wildcard) rather than the exact tab URL/port,
 * matching how disabledSites/isSiteDisabled already treat "this site" as
 * hostname-scoped elsewhere in this codebase. Persisted by Chrome itself
 * (also visible/manageable under chrome://settings/content/camera etc.),
 * not in Moat's own settings storage. */
export async function allowPermissionGuardOrigin(kind: PermissionGuardKind, hostname: string): Promise<void> {
  const api = contentSettingsApi();
  const setting = api && settingFor(api, kind);
  if (!setting) return;
  try {
    await setting.set({ primaryPattern: `*://${hostname}/*`, setting: "allow" });
  } catch {
    // Same reasoning as applyPermissionGuard's catch above.
  }
}
