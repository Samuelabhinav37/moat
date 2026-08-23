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
  thirdPartyCookiesAllowed?: { set(details: { value: boolean }): Promise<void> };
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

export async function applyPrivacySettings(settings: Settings): Promise<void> {
  const privacy = browser.privacy;
  if (!privacy) return;

  await apply(
    privacy.network?.webRTCIPHandlingPolicy,
    settings.webrtcLeakProtection ? "disable_non_proxied_udp" : "default"
  );

  const websites = privacy.websites as (typeof privacy.websites & ChromeThirdPartyCookies) | undefined;
  if (websites?.thirdPartyCookiesAllowed) {
    await apply(websites.thirdPartyCookiesAllowed, !settings.blockThirdPartyCookies);
  } else {
    await apply(websites?.cookieConfig, {
      behavior: settings.blockThirdPartyCookies ? "reject_third_party" : "allow_all",
    });
  }

  // Firefox-only native setting that makes it send the GPC signal (and
  // expose navigator.globalPrivacyControl) itself, on top of the DNR header
  // rule and page-context patch we apply everywhere. Not gated by an
  // opt-in toggle -- it's the same signal we already send, just also
  // reported through the browser's own, likely more complete, mechanism.
  await apply(privacy.network?.globalPrivacyControl, true);
}
