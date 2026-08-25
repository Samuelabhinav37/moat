// Applies the two opt-in browser-wide privacy toggles via the `privacy`
// API. These are the only settings in this extension that reach outside
// the pages it protects, so unlike everything else here they're off by
// default and only take effect once the user explicitly flips them on.
//
// Chrome and Firefox expose third-party-cookie blocking under genuinely
// different shapes (Chrome: a plain `thirdPartyCookiesAllowed` boolean;
// Firefox: a `cookieConfig` object with a `behavior` enum) -- @types/
// webextension-polyfill only models Firefox's, so the Chrome path below is
// runtime-feature-detected and cast rather than statically typed.
import browser from "webextension-polyfill";
import type { Settings } from "../types";

interface ChromeThirdPartyCookies {
  thirdPartyCookiesAllowed?: { set(details: { value: boolean }): Promise<void>; clear(details: object): Promise<void> };
}

async function apply<T>(
  setting: { set(details: { value: T }): Promise<void> } | undefined,
  value: T
): Promise<void> {
  if (!setting) return;
  try {
    await setting.set({ value });
  } catch {
    // Locked by enterprise policy, unsupported on this browser/version, or
    // this profile is Incognito (some privacy.* settings reject that scope)
    // -- none of that should take the rest of the extension down with it.
  }
}

// Like `apply`, but for the two opt-in toggles: `.set()` with the "off"
// value still marks the setting "controlled by this extension" in
// chrome://settings, which isn't the same as leaving it alone. `.clear()`
// actually relinquishes control back to the browser/another extension/OS
// default when the toggle is off, so a fresh install with every toggle at
// its default takes ownership of nothing.
async function applyOrClear<T>(
  // `clear`'s details shape differs (and is all-optional) across the three
  // settings this is called with; typing it exactly isn't worth the
  // friction for an internal helper.
  setting: { set(details: { value: T }): Promise<void>; clear(details: any): Promise<void> } | undefined,
  isOn: boolean,
  onValue: T
): Promise<void> {
  if (!setting) return;
  try {
    if (isOn) await setting.set({ value: onValue });
    else await setting.clear({});
  } catch {
    // Same reasoning as `apply`'s catch above.
  }
}

export async function applyPrivacySettings(settings: Settings): Promise<void> {
  const privacy = browser.privacy;
  if (!privacy) return;

  await applyOrClear(
    privacy.network?.webRTCIPHandlingPolicy,
    settings.webrtcLeakProtection,
    "disable_non_proxied_udp"
  );

  const websites = privacy.websites as (typeof privacy.websites & ChromeThirdPartyCookies) | undefined;
  if (websites?.thirdPartyCookiesAllowed) {
    await applyOrClear(websites.thirdPartyCookiesAllowed, settings.blockThirdPartyCookies, false);
  } else {
    await applyOrClear(websites?.cookieConfig, settings.blockThirdPartyCookies, {
      behavior: "reject_third_party",
    });
  }

  // Firefox-only native setting that makes it send the GPC signal (and
  // expose navigator.globalPrivacyControl) itself, on top of the DNR header
  // rule and page-context patch we apply everywhere. Not gated by an
  // opt-in toggle -- it's the same signal we already send, just also
  // reported through the browser's own, likely more complete, mechanism.
  await apply(privacy.network?.globalPrivacyControl, true);
}
