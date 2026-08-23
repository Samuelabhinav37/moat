// Isolated-world content script, top frame only, inactive until it gets a
// {type: "start-picker"} message from popup.ts. Lets you hover/click an
// element on the page, then either save it (reapplied on future visits, via
// customCosmeticRules in Settings) or hide it just for this page load
// (uBO's "Zapper" behavior -- nothing persisted). A third mode, "Gray out",
// tones the element down (filter: grayscale) instead of removing it --
// for things like video-ad wrappers where hiding would break the layout.
import browser from "webextension-polyfill";
import { generateSelector, isUnpickable } from "./generateSelector";
import type { SaveCosmeticRuleMessage, SaveGrayscaleRuleMessage } from "../types";

const Z_INDEX = 2147483647;
const STYLE_ELEMENT_ID = "moat-picker-style";

let picking = false;
let highlighted: Element | null = null;
let overlay: HTMLDivElement | null = null;
let panel: HTMLDivElement | null = null;

function ensureStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  document.documentElement.append(style);
  return style;
}

function hideSelector(selector: string): void {
  ensureStyleElement().append(`${selector}{display:none!important}\n`);
}

function graySelector(selector: string): void {
  ensureStyleElement().append(`${selector}{filter:grayscale(1)!important}\n`);
}

function createOverlay(): HTMLDivElement {
  const div = document.createElement("div");
  Object.assign(div.style, {
    position: "fixed",
    pointerEvents: "none",
    background: "rgba(217, 119, 87, 0.25)",
    outline: "2px solid #d97757",
    zIndex: String(Z_INDEX),
    transition: "all 0.05s ease",
  });
  document.documentElement.append(div);
  return div;
}

function positionOverlay(element: Element): void {
  if (!overlay) return;
  const rect = element.getBoundingClientRect();
  Object.assign(overlay.style, {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

type PickMode = "save" | "temporary" | "gray";

function createPanel(selector: string, onPick: (mode: PickMode) => void, onCancel: () => void): HTMLDivElement {
  const div = document.createElement("div");
  Object.assign(div.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: String(Z_INDEX),
    background: "#1c1f21",
    color: "#e7ebed",
    border: "1px solid #33383b",
    borderRadius: "8px",
    padding: "12px",
    font: "13px/1.4 system-ui, -apple-system, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    maxWidth: "320px",
  });

  const label = document.createElement("div");
  label.textContent = "What do you want to do with this?";
  label.style.marginBottom = "6px";

  const code = document.createElement("code");
  code.textContent = selector;
  Object.assign(code.style, {
    display: "block",
    background: "#0f1210",
    padding: "4px 6px",
    borderRadius: "4px",
    marginBottom: "10px",
    wordBreak: "break-all",
    fontSize: "12px",
  });

  const buttonRow = document.createElement("div");
  Object.assign(buttonRow.style, { display: "flex", gap: "6px", flexWrap: "wrap" });

  function makeButton(text: string, variant: "primary" | "danger" | "plain", onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = text;
    const colors = {
      primary: { border: "#5fb896", background: "#5fb896", color: "#0f1210" },
      danger: { border: "#d97757", background: "transparent", color: "#d97757" },
      plain: { border: "#33383b", background: "transparent", color: "#e7ebed" },
    }[variant];
    Object.assign(button.style, {
      font: "inherit",
      cursor: "pointer",
      borderRadius: "6px",
      border: `1px solid ${colors.border}`,
      background: colors.background,
      color: colors.color,
      padding: "6px 10px",
    });
    button.addEventListener("click", onClick);
    return button;
  }

  buttonRow.append(
    makeButton("Hide on this site", "primary", () => onPick("save")),
    makeButton("Hide for now", "plain", () => onPick("temporary")),
    makeButton("Gray out", "danger", () => onPick("gray")),
    makeButton("Cancel", "plain", onCancel)
  );

  div.append(label, code, buttonRow);
  document.documentElement.append(div);
  return div;
}

function teardown(): void {
  picking = false;
  highlighted = null;
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKeyDown, true);
  overlay?.remove();
  overlay = null;
  panel?.remove();
  panel = null;
}

function onMouseOver(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element) || isUnpickable(target)) return;
  highlighted = target;
  positionOverlay(target);
}

function onClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (!highlighted) return;

  const element = highlighted;
  const selector = generateSelector(element);

  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onClick, true);

  panel = createPanel(
    selector,
    (mode) => {
      if (mode === "gray") {
        graySelector(selector);
        const message: SaveGrayscaleRuleMessage = { type: "save-grayscale-rule", hostname: location.hostname, selector };
        browser.runtime.sendMessage(message).catch(() => {
          // Already grayed out locally either way; a missed save just
          // means it won't be remembered next visit.
        });
      } else {
        hideSelector(selector);
        if (mode === "save") {
          const message: SaveCosmeticRuleMessage = { type: "save-cosmetic-rule", hostname: location.hostname, selector };
          browser.runtime.sendMessage(message).catch(() => {
            // The element is already hidden locally either way; a missed
            // save just means it won't be remembered next visit.
          });
        }
      }
      teardown();
    },
    teardown
  );
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") teardown();
}

function startPicking(): void {
  if (picking) return;
  picking = true;
  overlay = createOverlay();
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}

browser.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as { type?: string };
  if (message?.type === "start-picker") startPicking();
});
