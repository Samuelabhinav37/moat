// Isolated-world content script, top frame only, inactive until it gets a
// {type: "start-picker"} message from popup.ts. Lets you point at something
// on the page, click it, and then hide it on this site for good (reapplied on
// future visits, via customCosmeticRules in Settings), hide it just for this
// page load (uBO's "Zapper" behavior, nothing saved), or gray it out
// (filter: grayscale) for things like video-ad wrappers where hiding would
// break the layout.
//
// The picker's own UI lives in a closed shadow root so the page's CSS can't
// restyle it, uses Moat's own colours, and says what was picked in words
// ("Image, 300 × 250") rather than as a CSS selector (still one click away
// under Details). After a click the element is shown faded as a preview, and
// Bigger / Smaller step out to its parent or back in before anything is
// saved. Enter confirms, Esc cancels, the arrow keys step.
import browser from "webextension-polyfill";
import { generateSelector, isUnpickable } from "./generateSelector";
import type { SaveCosmeticRuleMessage, SaveGrayscaleRuleMessage } from "../types";

const Z_INDEX = "2147483647";
const STYLE_ELEMENT_ID = "moat-picker-style";
const HOST_ATTR = "data-moat-picker";

function t(key: string, fallback: string, substitutions?: string | string[]): string {
  try {
    return browser.i18n.getMessage(key, substitutions) || fallback;
  } catch {
    return fallback;
  }
}

// ---------- Pure helpers (exported for tests) ----------

export type ElementKind = "image" | "frame" | "video" | "link" | "text" | "box";

export function elementKind(element: Element): ElementKind {
  const tag = element.tagName.toLowerCase();
  if (tag === "img" || tag === "picture" || tag === "svg" || tag === "canvas") return "image";
  if (tag === "iframe" || tag === "embed" || tag === "object") return "frame";
  if (tag === "video" || tag === "audio") return "video";
  if (tag === "a") return "link";
  if (/^(p|span|h[1-6]|em|strong|b|i|small|label|li)$/.test(tag)) return "text";
  return "box";
}

const KIND_LABELS: Record<ElementKind, [string, string]> = {
  image: ["pickerKindImage", "Image"],
  frame: ["pickerKindFrame", "Embedded frame"],
  video: ["pickerKindVideo", "Video"],
  link: ["pickerKindLink", "Link"],
  text: ["pickerKindText", "Text"],
  box: ["pickerKindBox", "Box"],
};

/** "Image, 300 × 250": what was picked, in words people use. */
export function describeElement(element: Element): string {
  const [key, fallback] = KIND_LABELS[elementKind(element)];
  const rect = element.getBoundingClientRect();
  return `${t(key, fallback)}, ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

/** The chain Bigger / Smaller walks: the clicked element first, then each
 * ancestor up to (not including) body. */
export function selectionPath(element: Element): Element[] {
  const path: Element[] = [];
  for (let el: Element | null = element; el && !isUnpickable(el); el = el.parentElement) path.push(el);
  return path;
}

/** True when `parent` holds nothing but `child`: no other visible element
 * and no text of its own. When the browser can measure both, the parent must
 * also be at most twice the child's area, so a lone ad in a big page
 * section doesn't pull the whole section in. */
export function wrapsOnly(parent: Element, child: Element): boolean {
  if (parent.children.length !== 1 || parent.firstElementChild !== child) return false;
  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false;
  }
  const outer = parent.getBoundingClientRect();
  const inner = child.getBoundingClientRect();
  const innerArea = inner.width * inner.height;
  if (innerArea > 0 && outer.width * outer.height > innerArea * 2) return false;
  return true;
}

/** Where on the path to start: the clicked element, or up to three wrappers
 * above it that hold nothing else (an ad inside its own bordered box).
 * Hiding just the ad would leave the empty box behind. Select less still
 * steps back down. */
export function startingStep(path: Element[]): number {
  let step = 0;
  while (step < Math.min(3, path.length - 1) && wrapsOnly(path[step + 1]!, path[step]!)) step++;
  return step;
}

/** Places the card beside the picked element: below it if it fits, else
 * above, else pinned to the bottom of the screen; always inside the viewport
 * and never on top of the element when there's room elsewhere. */
export function cardPosition(
  target: { top: number; bottom: number; left: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 10
): { top: number; left: number } {
  const margin = 12;
  const left = Math.min(Math.max(target.left, margin), Math.max(margin, viewport.width - card.width - margin));
  if (target.bottom + gap + card.height <= viewport.height - margin) return { top: Math.max(margin, target.bottom + gap), left };
  if (target.top - gap - card.height >= margin) return { top: target.top - gap - card.height, left };
  return { top: viewport.height - card.height - margin, left };
}

// ---------- UI ----------

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.outline {
  position: fixed; pointer-events: none; z-index: 1;
  border: 2px solid #6f9be0; background: rgba(111, 155, 224, 0.15); border-radius: 4px;
  transition: top .06s ease, left .06s ease, width .06s ease, height .06s ease;
}
.outline.picked { border-style: dashed; background: rgba(111, 155, 224, 0.08); }
.pill {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2;
  pointer-events: none; padding: 9px 14px; border-radius: 999px;
  background: #1b191d; color: #eceef0; border: 1px solid #37343b;
  font: 600 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); white-space: nowrap;
}
.pill kbd { font: inherit; color: #a7a1ac; }
.card {
  position: fixed; z-index: 3; width: 320px; pointer-events: auto;
  padding: 14px; border-radius: 14px; background: #1b191d; color: #eceef0;
  border: 1px solid #37343b; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.title { font-weight: 650; font-size: 14.5px; }
.what { color: #a7a1ac; margin-top: 2px; }
.size { display: flex; gap: 6px; margin-top: 12px; }
button {
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 9px;
  padding: 8px 12px; border: 1px solid #37343b; background: #242229; color: #eceef0;
}
button:hover { background: #2b2830; }
button:focus-visible { outline: 2px solid #6f9be0; outline-offset: 2px; }
button:disabled { opacity: .45; cursor: default; }
.size button { padding: 5px 10px; font-size: 12.5px; }
.primary {
  display: block; width: 100%; margin-top: 12px; background: #3f6fd1; border-color: #3f6fd1; color: #fff;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.primary:hover { background: #2f57ad; }
.links { display: flex; gap: 14px; align-items: center; margin-top: 10px; }
.links .muted { margin-left: auto; }
.link { border: 0; background: none; padding: 4px 0; color: #6f9be0; font-weight: 600; }
.link:hover { background: none; text-decoration: underline; }
.muted { color: #a7a1ac; }
details { margin-top: 10px; color: #a7a1ac; font-size: 12.5px; }
summary { cursor: pointer; }
details .link { display: block; margin-top: 6px; }
code {
  display: block; margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: #111015;
  color: #eceef0; font: 12px/1.4 ui-monospace, Consolas, monospace; word-break: break-all;
}
@media (prefers-reduced-motion: reduce) { .outline { transition: none; } }
`;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let outline: HTMLDivElement | null = null;
let pill: HTMLDivElement | null = null;
let card: HTMLDivElement | null = null;
let hovered: Element | null = null;
let path: Element[] = [];
let step = 0;
let previewed: { element: HTMLElement; opacity: string; priority: string } | null = null;

function ensureStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  document.documentElement.append(style);
  return style;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function placeOutline(element: Element): void {
  if (!outline) return;
  const rect = element.getBoundingClientRect();
  Object.assign(outline.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}

function isOurs(target: EventTarget | null): boolean {
  return target instanceof Element && (target === host || target.hasAttribute(HOST_ATTR));
}

function setPreview(element: Element | null): void {
  if (previewed) {
    previewed.element.style.setProperty("opacity", previewed.opacity, previewed.priority);
    previewed = null;
  }
  if (element instanceof HTMLElement) {
    previewed = { element, opacity: element.style.getPropertyValue("opacity"), priority: element.style.getPropertyPriority("opacity") };
    element.style.setProperty("opacity", "0.2", "important");
  }
}

export function teardown(): void {
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("scroll", reposition, true);
  setPreview(null);
  host?.remove();
  host = root = null;
  outline = pill = card = null;
  hovered = null;
  path = [];
  step = 0;
}

function onMouseOver(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element) || isOurs(target) || isUnpickable(target)) return;
  hovered = target;
  placeOutline(target);
}

function onClick(event: MouseEvent): void {
  if (isOurs(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!hovered) return;
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onClick, true);
  pick(hovered);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    teardown();
    return;
  }
  if (!card) return;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    resize(1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    resize(-1);
  } else if (event.key === "Enter" && !(root?.activeElement instanceof HTMLButtonElement && root.activeElement !== card.querySelector(".primary"))) {
    event.preventDefault();
    finish("save");
  }
}

type PickMode = "save" | "temporary" | "gray";

function finish(mode: PickMode): void {
  const element = path[step];
  if (!element) return teardown();
  const selector = generateSelector(element);
  if (mode === "gray") {
    ensureStyleElement().append(`${selector}{filter:grayscale(1)!important}\n`);
    const message: SaveGrayscaleRuleMessage = { type: "save-grayscale-rule", hostname: location.hostname, selector };
    // Already grayed out locally either way; a missed save just means it
    // won't be remembered next visit.
    browser.runtime.sendMessage(message).catch(() => {});
  } else {
    ensureStyleElement().append(`${selector}{display:none!important}\n`);
    if (mode === "save") {
      const message: SaveCosmeticRuleMessage = { type: "save-cosmetic-rule", hostname: location.hostname, selector };
      browser.runtime.sendMessage(message).catch(() => {});
    }
  }
  teardown();
}

function resize(delta: number): void {
  const next = Math.min(Math.max(step + delta, 0), path.length - 1);
  if (next === step) return;
  step = next;
  renderCard();
}

function renderCard(): void {
  if (!root || !card) return;
  const element = path[step]!;
  setPreview(element);
  placeOutline(element);
  outline?.classList.add("picked");

  const site = location.hostname.replace(/^www\./, "") || location.host;
  const bigger = el("button", undefined, t("pickerBigger", "Select more"));
  bigger.type = "button";
  bigger.disabled = step >= path.length - 1;
  bigger.setAttribute("aria-keyshortcuts", "ArrowUp");
  bigger.addEventListener("click", () => resize(1));
  const smaller = el("button", undefined, t("pickerSmaller", "Select less"));
  smaller.type = "button";
  smaller.disabled = step === 0;
  smaller.setAttribute("aria-keyshortcuts", "ArrowDown");
  smaller.addEventListener("click", () => resize(-1));

  const primary = el("button", "primary", t("pickerHideOnSite", `Hide on ${site}`, site));
  primary.type = "button";
  primary.addEventListener("click", () => finish("save"));
  const once = el("button", undefined, t("pickerJustOnce", "Hide until reload"));
  once.type = "button";
  once.addEventListener("click", () => finish("temporary"));

  const gray = el("button", "link", t("pickerGrayOut", "Gray out instead"));
  gray.type = "button";
  gray.addEventListener("click", () => finish("gray"));
  const cancel = el("button", "link muted", t("commonCancel", "Cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", teardown);

  // The less common choice and the technical detail stay folded away.
  const details = el("details");
  details.append(el("summary", undefined, t("pickerDetails", "Details")), gray, el("code", undefined, generateSelector(element)));

  primary.title = primary.textContent ?? "";
  const size = el("div", "size");
  size.append(bigger, smaller);
  const links = el("div", "links");
  links.append(once, cancel);
  card.replaceChildren(
    el("div", "title", t("pickerTitle", "Hide this?")),
    el("div", "what", describeElement(element)),
    size,
    primary,
    links,
    details
  );

  reposition();
  primary.focus({ preventScroll: true });
}

/** Keeps the outline and card on the picked element as the page scrolls. */
function reposition(): void {
  const element = path[step];
  if (!element || !card) return;
  placeOutline(element);
  const rect = element.getBoundingClientRect();
  const { top, left } = cardPosition(rect, { width: 320, height: card.offsetHeight || 200 }, { width: innerWidth, height: innerHeight });
  Object.assign(card.style, { top: `${top}px`, left: `${left}px` });
}

function pick(element: Element): void {
  if (!root) return;
  path = selectionPath(element);
  step = startingStep(path);
  pill?.remove();
  pill = null;
  card = el("div", "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", t("pickerTitle", "Hide this?"));
  root.append(card);
  window.addEventListener("scroll", reposition, true);
  renderCard();
}

export function startPicking(): void {
  if (host) return;
  host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  Object.assign(host.style, { position: "fixed", inset: "0", zIndex: Z_INDEX, pointerEvents: "none" });
  root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  outline = el("div", "outline");
  pill = el("div", "pill", t("pickerHint", "Click anything to hide it. Press Esc to cancel."));
  root.append(style, outline, pill);
  document.documentElement.append(host);
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}

/** Test hook: the same as clicking `element` while picking. */
export function pickForTest(element: Element): ShadowRoot | null {
  pick(element);
  return root;
}

browser.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as { type?: string };
  if (message?.type === "start-picker") startPicking();
});
