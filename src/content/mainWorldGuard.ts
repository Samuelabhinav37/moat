// Runs in the page's MAIN world at document_start, before any page script.
// No extension APIs exist here (that's what bridge.ts is for) -- this file
// only ever talks back to the extension over a private MessagePort from
// bridge.ts (see GUARD_CONNECT_EVENT in types.ts).
import { GUARD_CONNECT_EVENT, type GuardBlockKind, type GuardBlockReport, type PopupGuardConfig } from "../types";
import { isAuthPopupUrl } from "./authPopup";
import { isFrameEscape, type FrameContext } from "./frameEscape";
import { isPlausibleTrigger } from "./isPlausibleTrigger";
import { createPopupRateLimiter } from "./popupRateLimit";
import { maskRealm, nativeGetter, nativeMethod } from "./nativeToString";

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
//
// Defined the way a browser that supports GPC defines it (Firefox, Brave):
// an accessor on Navigator.prototype. An own data property on the navigator
// object is something no browser has, and bot-detection scripts list
// navigator's own properties to spot exactly that kind of edit.
if (navigator.globalPrivacyControl !== true) {
  try {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
      get: nativeGetter("globalPrivacyControl", undefined, () => true),
      configurable: true,
      enumerable: true,
    });
  } catch {
    // Already defined as non-configurable by the browser itself; leave it.
  }
}

const nativeOpen = window.open.bind(window);
const nativeWindowOpen = window.open;

let siteDisabled = false;
let lastTrustedClick: { time: number; target: EventTarget | null; consumed: boolean } | null = null;
const popupRateLimiter = createPopupRateLimiter();

// Private channel to bridge.ts, handed over at document_start before any
// page script runs (see GUARD_CONNECT_EVENT in types.ts). The first port
// wins; a page can't hand over a port of its own because it has no script
// running yet when the real one arrives.
let bridgePort: MessagePort | null = null;

// Chrome keeps a click's user activation for 5 s, and sign-in code often
// awaits a network round trip before it opens the popup (MSAL fetches the
// tenant's metadata first). 1.2 s was shorter than that and blocked them.
const TRUST_WINDOW_MS = 5000;

function report(kind: GuardBlockKind, url: string | null): void {
  // Before the port arrives the report is dropped: at most one uncounted
  // block, never a missed one (the block itself already happened).
  bridgePort?.postMessage({ kind, url } satisfies GuardBlockReport);
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

/** Where this frame sits, for the frame-escape check. */
function frameContext(): FrameContext {
  let isTop = true;
  try {
    isTop = window.top === window;
  } catch {
    isTop = false;
  }
  return {
    href: location.href,
    isTop,
    ancestorOrigins: location.ancestorOrigins ? Array.from(location.ancestorOrigins) : [],
    referrer: document.referrer,
  };
}

/** Whether the page may open a new window right now, from window.open or
 * anything that does the same job (a script-clicked new-tab link the click
 * listener can't see, a form submitted to a new tab, a frame's open()).
 * Reports the block when it says no. */
function mayOpenWindow(url: unknown, kind: GuardBlockKind): boolean {
  if (siteDisabled) return true;

  const active = navigator.userActivation?.isActive ?? false;
  // A sign-in page the user asked for: no click-shape checks, no one-per-
  // click limit (some flows open a second window after an error), no rate
  // limit. Still needs the browser's own live user gesture.
  if (active && isAuthPopupUrl(url as Parameters<typeof window.open>[0], location.href)) return true;
  // An ad frame embedded from another site can't open a third site, even
  // on a real click on a real button (frameEscape.ts has the measured case).
  if (isFrameEscape(url as string | URL | undefined, frameContext())) {
    report(kind, typeof url === "string" ? url : url instanceof URL ? url.href : null);
    return false;
  }
  const recentTrusted = lastTrustedClick !== null && performance.now() - lastTrustedClick.time < TRUST_WINDOW_MS;
  const plausible = recentTrusted && isPlausibleTrigger(lastTrustedClick!.target);
  const freshClick = recentTrusted && !lastTrustedClick!.consumed;

  // Checked last, and only consumes the click if everything else already
  // passed: a large-but-genuinely-visible element (a real modal's close
  // button, say) is deliberately allowed through isPlausibleTrigger -- see
  // its own tests -- so a site that wires its visible player area to open a
  // new popup on every click passes that check every time, individually.
  // No legitimate page needs more than a couple of genuinely-intentional
  // new-tab opens in quick succession; capping it here catches the barrage
  // pattern without touching the click-plausibility heuristic itself.
  if (active && plausible && freshClick && popupRateLimiter.tryApprove(performance.now())) {
    lastTrustedClick!.consumed = true;
    return true;
  }

  report(kind, typeof url === "string" ? url : url instanceof URL ? url.href : null);
  return false;
}

// nativeMethod: same name/length as the real window.open, no prototype,
// not constructible, toString masked -- see nativeToString.ts.
window.open = nativeMethod<typeof window.open>(nativeWindowOpen, function guardedOpen(
  ...args: Parameters<typeof window.open>
): ReturnType<typeof window.open> {
  return mayOpenWindow(args[0], "window-open") ? nativeOpen(...args) : null;
});

// Frames the page makes itself (about:blank, srcdoc, blob:) share its origin,
// so their window.open was a way around the one above. Chrome runs this file
// in about:blank and blob: frames before the page can touch them, but a
// srcdoc frame's first, empty document gets nothing. So the moment the page
// reaches into a same-origin frame, its open() is replaced with one that
// asks this page's guard, using this page's clicks.
const guardedFrames = new WeakSet<Window>();

function guardFrameWindow(child: Window | null): void {
  if (!child || child === window || guardedFrames.has(child)) return;
  let childOpen: typeof window.open;
  try {
    childOpen = child.open; // throws for a cross-origin frame, which can't reach this page anyway
  } catch {
    return;
  }
  guardedFrames.add(child);
  maskRealm(child);
  try {
    child.open = nativeMethod<typeof window.open>(childOpen, function guardedFrameOpen(
      ...args: Parameters<typeof window.open>
    ): ReturnType<typeof window.open> {
      return mayOpenWindow(args[0], "window-open") ? childOpen.apply(child, args) : null;
    });
  } catch {
    // A frame that won't take the property: leave it, nothing else to do.
  }
}

for (const ctor of [HTMLIFrameElement, HTMLFrameElement, HTMLObjectElement]) {
  for (const property of ["contentWindow", "contentDocument"] as const) {
    const native = Object.getOwnPropertyDescriptor(ctor.prototype, property);
    if (!native?.get) continue;
    const realGetter = native.get;
    Object.defineProperty(ctor.prototype, property, {
      ...native,
      get: nativeGetter(property, realGetter, function (this: Element) {
        const value = realGetter.call(this) as Window | Document | null;
        // Not instanceof Document: the frame's Document is its own realm's.
        guardFrameWindow(property === "contentDocument" ? ((value as Document | null)?.defaultView ?? null) : (value as Window | null));
        return value;
      }),
    });
  }
}

/** A target that opens a new window. */
function opensNewWindow(target: string | null | undefined): boolean {
  const t = (target ?? "").trim().toLowerCase();
  return t === "_blank" || t === "blank";
}

/** The click listener above sees script clicks on new-tab links in the
 * page. A link never added to the page, or inside a shadow root (closed
 * ones hide it from the listener entirely), opened a new tab unseen. */
function unseenNewTabLink(element: Element): HTMLAnchorElement | HTMLAreaElement | null {
  const link = element.closest("a[href], area[href]");
  if (!(link instanceof HTMLAnchorElement || link instanceof HTMLAreaElement)) return null;
  if (!opensNewWindow(link.getAttribute("target")) || link.hasAttribute("download")) return null;
  return !link.isConnected || link.getRootNode() instanceof ShadowRoot ? link : null;
}

/** A submit button whose form goes to a new tab. */
function newTabSubmitter(element: Element): HTMLButtonElement | HTMLInputElement | null {
  if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement)) return null;
  if (element.type !== "submit" && element.type !== "image") return null;
  const form = element.form;
  if (!form) return null;
  return opensNewWindow(element.getAttribute("formtarget") ?? form.target) ? element : null;
}

/** Whether a script-driven click on `element` may go ahead. */
function mayScriptClick(element: Element): boolean {
  const link = unseenNewTabLink(element);
  if (link) return mayOpenWindow(link.href, "synthetic-click");
  const submitter = newTabSubmitter(element);
  if (submitter) return mayOpenWindow(submitter.formAction, "synthetic-click");
  return true;
}

const nativeClick = HTMLElement.prototype.click;
HTMLElement.prototype.click = nativeMethod<typeof nativeClick>(nativeClick, function guardedClick(this: HTMLElement): void {
  if (mayScriptClick(this)) nativeClick.call(this);
});

const nativeDispatchEvent = EventTarget.prototype.dispatchEvent;
EventTarget.prototype.dispatchEvent = nativeMethod<typeof nativeDispatchEvent>(nativeDispatchEvent, function guardedDispatchEvent(
  this: EventTarget,
  event: Event
): boolean {
  if (event?.type === "click" && this instanceof Element && !mayScriptClick(this)) return false;
  return nativeDispatchEvent.call(this, event);
});

const nativeSubmit = HTMLFormElement.prototype.submit;
HTMLFormElement.prototype.submit = nativeMethod<typeof nativeSubmit>(nativeSubmit, function guardedSubmit(this: HTMLFormElement): void {
  if (!opensNewWindow(this.target) || mayOpenWindow(this.action, "window-open")) nativeSubmit.call(this);
});

const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
if (nativeRequestSubmit) {
  HTMLFormElement.prototype.requestSubmit = nativeMethod<typeof nativeRequestSubmit>(nativeRequestSubmit, function guardedRequestSubmit(
    this: HTMLFormElement,
    submitter?: HTMLElement | null
  ): void {
    const target = submitter?.getAttribute("formtarget") ?? this.target;
    if (!opensNewWindow(target) || mayOpenWindow(this.action, "window-open")) nativeRequestSubmit.call(this, submitter);
  });
}

document.addEventListener(GUARD_CONNECT_EVENT, (event) => {
  const port = (event as MessageEvent).ports?.[0];
  if (bridgePort || !port) return;
  bridgePort = port;
  port.onmessage = (message: MessageEvent<PopupGuardConfig>) => {
    if (typeof message.data?.disabled === "boolean") siteDisabled = message.data.disabled;
  };
});
