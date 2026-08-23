// Runs in the page's MAIN world at document_start, before any page script.
// No extension APIs exist here (that's what bridge.ts is for) -- this file
// only ever talks back to the extension via window.postMessage.
import type { BridgeMessage, GuardBlockKind } from "../types";

declare global {
  interface Navigator {
    /** Not yet in lib.dom.d.ts. https://globalprivacycontrol.org/ */
    globalPrivacyControl?: boolean;
  }
}

// Global Privacy Control: a legally binding opt-out signal in a growing
// number of US states. The Sec-GPC request header is set by a DNR rule
// (ruleset_privacy-headers); this is the matching page-visible half of the
// signal that JS-based consent tools read. Always on, independent of the
// per-site pause toggle below -- it's purely declarative and can't break a
// page the way the popup guard sometimes needs pausing for.
if (navigator.globalPrivacyControl !== true) {
  try {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    // Already defined as non-configurable by the browser itself; leave it.
  }
}

const nativeOpen = window.open.bind(window);

let siteDisabled = false;
let lastTrustedClick: { time: number; target: EventTarget | null; consumed: boolean } | null = null;

const TRUST_WINDOW_MS = 1200;

function report(kind: GuardBlockKind, url: string | null): void {
  const message: BridgeMessage = { source: "silent-adblock", type: "blocked", kind, url };
  window.postMessage(message, "*");
}

function isPlausibleTrigger(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'a,button,[role="button"],input[type="submit"],input[type="button"],label,summary'
  );
  if (!interactive) return false;

  const rect = interactive.getBoundingClientRect();
  const style = getComputedStyle(interactive);
  const coversViewport = rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
  const nearInvisible = parseFloat(style.opacity) < 0.05;
  // The classic hijack pattern: an invisible, full-viewport element sitting
  // over the page catching every click and treating it as "the" trigger.
  if (coversViewport && nearInvisible) return false;

  return true;
}

document.addEventListener(
  "pointerdown",
  (event) => {
    if (!event.isTrusted) return;
    lastTrustedClick = { time: performance.now(), target: event.target, consumed: false };
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    if (event.isTrusted) {
      // Covers keyboard-activated clicks (Enter/Space on a focused button),
      // which fire "click" without a preceding "pointerdown".
      lastTrustedClick = { time: performance.now(), target: event.target, consumed: false };
      return;
    }

    // Untrusted (script-dispatched) click on a target=_blank link is a
    // common way ad scripts fake a "user opened this in a new tab" moment.
    if (siteDisabled || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[target="_blank"], a[target="blank"]');
    if (anchor instanceof HTMLAnchorElement && anchor.href && !anchor.hasAttribute("download")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report("synthetic-click", anchor.href);
    }
  },
  true
);

window.open = function guardedOpen(...args: Parameters<typeof window.open>): ReturnType<typeof window.open> {
  if (siteDisabled) return nativeOpen(...args);

  const active = navigator.userActivation?.isActive ?? false;
  const recentTrusted = lastTrustedClick !== null && performance.now() - lastTrustedClick.time < TRUST_WINDOW_MS;
  const plausible = recentTrusted && isPlausibleTrigger(lastTrustedClick!.target);
  const freshClick = recentTrusted && !lastTrustedClick!.consumed;

  if (active && plausible && freshClick) {
    lastTrustedClick!.consumed = true;
    return nativeOpen(...args);
  }

  const url = args[0];
  report("window-open", typeof url === "string" ? url : url instanceof URL ? url.href : null);
  return null;
};

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeMessage | undefined;
  if (!data || data.source !== "silent-adblock" || data.type !== "config") return;
  siteDisabled = data.disabled;
});
